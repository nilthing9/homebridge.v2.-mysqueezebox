/**
 * homebridge-lyrion-control
 * Homebridge platform plugin for Lyrion Media Server (LMS) / Squeezebox
 *
 * Each LMS player is exposed as:
 *   - Fanv2 service  → Active = play/stop,  RotationSpeed = volume 0–100
 *   - SmartSpeaker   → CurrentMediaState / TargetMediaState (play/pause/stop)
 *
 * Both services stay in sync. Fan is what Siri and automations act on primarily.
 * SmartSpeaker adds explicit Pause support that a fan switch cannot express.
 *
 * NOTE: HAP v2+ removed named constants on CurrentMediaState / TargetMediaState.
 * We use raw numeric values per the HAP spec directly.
 *   CurrentMediaState: PLAYING=0, PAUSED=1, STOPPED=2, LOADING=3, INTERRUPTION=4
 *   TargetMediaState:  PLAY=0,    PAUSE=1,  STOP=2
 */

"use strict";

const axios = require("axios");


let Service, Characteristic, Categories;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  Categories = api.hap.Categories;
  api.registerPlatform("homebridge-lyrion-control", "LMSPlatform", LMSPlatform);
};

// ─────────────────────────────────────────────────────────────────
// PLATFORM
// ─────────────────────────────────────────────────────────────────

class LMSPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    if (!config || !config.serverurl) {
      this.log.error("LMSPlatform: 'serverurl' is required – plugin will not start.");
      this.log.error("Configure the plugin via the Homebridge UI or add serverurl to config.json.");
      return;
    }

    this.serverurl = config.serverurl.replace(/\/$/, "");
    this.debug = config.debug || false;
    this.updateInterval = (config.updateInterval || 5) * 1000;

    this.log.info(`LMS Platform initialised → ${this.serverurl}`);

    this.api.on("didFinishLaunching", () => {
      this.log.info("Homebridge ready – discovering LMS players…");
      this.discoverPlayers();
    });
  }

  // ── Discover / register players ──────────────────────────────────

  async discoverPlayers() {
    let players;
    try {
      players = await this.getPlayers();
    } catch (err) {
      this.log.error("discoverPlayers: failed to contact LMS –", err.message);
      return;
    }

    if (!players || players.length === 0) {
      this.log.warn("No players found. Check LMS is running and serverurl is correct.");
      return;
    }

    this.log.info(`Discovered ${players.length} player(s)`);

    for (const player of players) {
      this.log.info(`  • ${player.name}  id=${player.playerid}  model=${player.model}  connected=${player.connected}`);

      const uuid = this.api.hap.uuid.generate(player.playerid);
      const existing = this.accessories.find(a => a.UUID === uuid);

      if (existing) {
        this.log.debug(`Restoring cached accessory: ${player.name}`);
        new LMSPlayerAccessory(this, existing, player);
      } else {
        this.log.info(`Registering new accessory: ${player.name}`);
        const acc = new this.api.platformAccessory(player.name, uuid, Categories.SPEAKER);
        acc.context.player = player;
        new LMSPlayerAccessory(this, acc, player);
        this.api.registerPlatformAccessories("homebridge-lyrion-control", "LMSPlatform", [acc]);
        this.accessories.push(acc);
      }
    }
  }

  // ── LMS JSON-RPC helpers ─────────────────────────────────────────

  async getPlayers() {
    const result = await this.command("", ["players", 0, 99]);
    if (!result || !result.players_loop) return [];
    return result.players_loop.map(p => ({
      playerid: p.playerid,
      name: p.name,
      model: p.model || "squeezelite",
      connected: p.connected === 1,
    }));
  }

  async command(playerid, args) {
    const rpc = { id: 1, method: "slim.request", params: [playerid, args] };
    try {
      const res = await axios.post(`${this.serverurl}/jsonrpc.js`, rpc, { timeout: 4000 });
      if (this.debug) this.log.debug(`RPC [${playerid || "server"}] ${args[0]}:`, JSON.stringify(res.data?.result));
      return res.data?.result ?? null;
    } catch (err) {
      if (this.debug) this.log.error(`RPC error [${playerid}] ${args[0]}:`, err.message);
      return null;
    }
  }

  // ── Required by Homebridge – called for every cached accessory ───

  configureAccessory(accessory) {
    this.log.debug(`Loading cached accessory: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }
}

// ─────────────────────────────────────────────────────────────────
// PLAYER ACCESSORY
// ─────────────────────────────────────────────────────────────────

class LMSPlayerAccessory {
  constructor(platform, accessory, player) {
    this.platform = platform;
    this.accessory = accessory;
    this.player = player;
    this.log = platform.log;

    // Cached state – kept fresh by polling, read instantly on onGet
    this._playing = false;
    this._paused = false;
    this._volume = 50;

    this.accessory.context.player = player;

    // ── Accessory Information ────────────────────────────────────
    (this.accessory.getService(Service.AccessoryInformation)
      || this.accessory.addService(Service.AccessoryInformation))
      .setCharacteristic(Characteristic.Manufacturer, "Lyrion / Logitech")
      .setCharacteristic(Characteristic.Model, player.model || "Squeezelite")
      .setCharacteristic(Characteristic.SerialNumber, player.playerid)
      .setCharacteristic(Characteristic.Name, player.name);

    // ── Fan v2: Active = play/stop, RotationSpeed = volume ───────
    // Siri commands: "Turn on [name]" → play, "Turn off [name]" → stop
    //                "Set [name] to 50%" → volume 50
    this.fanService = this.accessory.getService(Service.Fanv2)
      || this.accessory.addService(Service.Fanv2, player.name);

    this.fanService
      .getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this));

    // ── Remove any legacy services from previous versions ────────
    const oldSpeaker = this.accessory.getService(Service.Speaker);
    if (oldSpeaker) {
      this.log.info(`${player.name}: removing legacy Speaker service`);
      this.accessory.removeService(oldSpeaker);
    }
    const oldSmartSpeaker = this.accessory.getService(Service.SmartSpeaker);
    if (oldSmartSpeaker) {
      this.log.info(`${player.name}: removing SmartSpeaker service`);
      this.accessory.removeService(oldSmartSpeaker);
    }

    // Offline tracking for backoff
    this._offlineCount = 0;       // consecutive failed polls
    this._isOffline = false;       // currently marked offline

    // Start polling immediately
    this.updateStatus();
    this.pollInterval = setInterval(() => this.updateStatus(), this.platform.updateInterval);
  }

  // ── Fan Active (play / stop) ─────────────────────────────────────

  async getActive() {
    return this._playing ? 1 : 0; // 1=ACTIVE, 0=INACTIVE
  }

  async setActive(value) {
    if (value === 1) {
      this.log.info(`${this.player.name}: play`);
      await this.platform.command(this.player.playerid, ["play"]);
      this._playing = true;
      this._paused = false;
    } else {
      this.log.info(`${this.player.name}: stop`);
      await this.platform.command(this.player.playerid, ["stop"]);
      this._playing = false;
      this._paused = false;
    }
  }

  // ── Volume via RotationSpeed ─────────────────────────────────────

  async getVolume() {
    return this._volume;
  }

  async setVolume(value) {
    this.log.info(`${this.player.name}: volume → ${value}`);
    this._volume = value;
    await this.platform.command(this.player.playerid, ["mixer", "volume", String(value)]);
  }



  // ── Status polling ───────────────────────────────────────────────

  async updateStatus() {
    // Backoff: skip this poll if player is offline and not due a retry yet
    if (this._isOffline) {
      this._offlineSkipCount = (this._offlineSkipCount || 0) + 1;
      // Retry every ~30s (6 × 5s polls). Reset counter and actually poll.
      if (this._offlineSkipCount < 6) return;
      this._offlineSkipCount = 0;
    }

    const status = await this.platform.command(this.player.playerid, ["status", "-", 1, "tags:al"]);

    if (!status) {
      // Poll failed — track consecutive failures
      this._offlineCount = (this._offlineCount || 0) + 1;
      if (!this._isOffline && this._offlineCount >= 3) {
        // 3 consecutive failures → mark offline, log once
        this._isOffline = true;
        this._offlineSkipCount = 0;
        this.log.warn(`${this.player.name}: player appears offline, reducing poll rate`);
      }
      return;
    }

    // Successful poll — check if we're recovering from offline
    if (this._isOffline) {
      this.log.info(`${this.player.name}: player back online`);
    }
    this._offlineCount = 0;
    this._isOffline = false;

    const mode = status.mode || "stop";
    this._playing = mode === "play";
    this._paused = mode === "pause";

    const rawVol = status["mixer volume"] ?? status.mixer_volume;
    if (rawVol !== undefined) {
      const vol = parseInt(rawVol);
      this._volume = Math.max(0, Math.min(100, isNaN(vol) ? 0 : vol));
    }

    // Push updates to HomeKit (no-op if value unchanged)
    this.fanService
      .getCharacteristic(Characteristic.Active)
      .updateValue(this._playing ? 1 : 0);

    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .updateValue(this._volume);

    if (this.platform.debug && status.playlist_loop?.[0]) {
      const t = status.playlist_loop[0];
      this.log.debug(`${this.player.name} ▶ ${t.artist || "?"} – ${t.title || "?"}`);
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────

  _syncFanState() {
    this.fanService
      .getCharacteristic(Characteristic.Active)
      .updateValue(this._playing ? 1 : 0);
  }
}
