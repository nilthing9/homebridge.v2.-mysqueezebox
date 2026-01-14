/**
 * Homebridge-MySqueezebox v2 – Platform Plugin with Auto-Discovery
 * Author: nilthing9
 * Features: Auto-discovers all LMS players, uses Lightbulb for reliable volume control
 */
const axios = require("axios");

let Service, Characteristic, Accessory;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  
  homebridge.registerPlatform("homebridge-mysqueezebox-v2", "MySqueezebox", MySqueezeboxPlatform, true);
};

class MySqueezeboxPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    
    if (!config) {
      this.log.error("No configuration found for MySqueezebox platform");
      return;
    }
    
    this.serverurl = config.serverurl || "http://localhost:9000";
    this.email = config.email || "";
    this.password = config.password || "";
    this.mysqueezebox = config.serverurl === undefined;
    this.debug = config.debug || false;
    this.pollingInterval = (config.pollingInterval || 30) * 1000;
    this.cookie = null;
    
    this.accessories = new Map();
    
    if (api) {
      this.api.on('didFinishLaunching', () => {
        this.log.info("MySqueezebox platform finished launching, discovering players...");
        this.discoverPlayers();
        
        setInterval(() => {
          this.discoverPlayers();
        }, this.pollingInterval);
      });
    }
  }

  async login() {
    if (!this.mysqueezebox) return;
    if (this.cookie) return;
    
    try {
      const response = await axios.post(`${this.serverurl}/user/login`, null, {
        params: { email: this.email, password: this.password },
        timeout: 5000,
      });
      
      if (response.headers["set-cookie"]) {
        this.cookie = response.headers["set-cookie"];
        if (this.debug) this.log.debug("Logged into MySqueezebox");
      }
    } catch (err) {
      this.log.error("Login failed:", err.message);
    }
  }

  async command(playerid, cmd) {
    try {
      await this.login();
      
      const rpc = { 
        id: 1, 
        method: "slim.request", 
        params: playerid ? [playerid, cmd] : ["", cmd]
      };
      
      const response = await axios.post(`${this.serverurl}/jsonrpc.js`, rpc, {
        timeout: 5000,
        headers: { Cookie: this.cookie ? this.cookie.join("; ") : "" },
      });
      
      if (this.debug && playerid) {
        this.log.debug(`[${playerid}] Command [${cmd.join(' ')}]:`, JSON.stringify(response.data.result));
      }
      
      return response.data.result;
    } catch (err) {
      this.log.error(`Command failed:`, err.message);
      return null;
    }
  }

  async discoverPlayers() {
    try {
      const result = await this.command(null, ["players", "0", "999"]);
      
      if (!result || !result.players_loop) {
        this.log.warn("No players found on LMS server");
        return;
      }
      
      this.log.info(`Found ${result.count} player(s) on LMS`);
      
      for (const player of result.players_loop) {
        const uuid = this.api.hap.uuid.generate(player.playerid);
        
        // Check if already registered
        if (this.accessories.has(uuid)) {
          if (this.debug) this.log.debug(`Player ${player.name} already registered`);
          continue;
        }
        
        this.log.info(`Discovered new player: ${player.name} (${player.playerid})`);
        
        // Sanitize name to avoid HAP warnings
        const sanitizedName = player.name.replace(/_/g, ' ').trim();
        
        const accessory = new Accessory(sanitizedName, uuid);
        accessory.context.playerid = player.playerid;
        accessory.context.playername = sanitizedName;
        accessory.context.model = player.model || "Squeezebox";
        
        this.configureAccessory(accessory);
        this.api.registerPlatformAccessories("homebridge-mysqueezebox-v2", "MySqueezebox", [accessory]);
      }
    } catch (err) {
      this.log.error("Player discovery failed:", err.message);
    }
  }

  configureAccessory(accessory) {
    this.log.info(`Configuring accessory: ${accessory.displayName}`);
    
    const playerid = accessory.context.playerid;
    const model = accessory.context.model || "Squeezebox";
    
    // Store in our map
    this.accessories.set(accessory.UUID, accessory);
    
    // Remove any existing services except AccessoryInformation
    const existingServices = accessory.services.slice();
    for (const service of existingServices) {
      if (service.UUID !== Service.AccessoryInformation.UUID) {
        accessory.removeService(service);
      }
    }
    
    // Information Service
    let infoService = accessory.getService(Service.AccessoryInformation);
    if (!infoService) {
      infoService = accessory.addService(Service.AccessoryInformation);
    }
    infoService
      .setCharacteristic(Characteristic.Manufacturer, "Logitech")
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, playerid)
      .setCharacteristic(Characteristic.Name, accessory.displayName);
    
    // Use Lightbulb service - On/Off = Play/Pause, Brightness = Volume
    const lightbulbService = accessory.addService(Service.Lightbulb, accessory.displayName);
    
    // On characteristic (playing = on, paused/stopped = off)
    lightbulbService
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        try {
          const result = await this.command(playerid, ["status", "-", "1", "tags:u"]);
          const isPlaying = result && result.mode === "play";
          if (this.debug) this.log.debug(`[${accessory.displayName}] Playing: ${isPlaying}`);
          return isPlaying;
        } catch (err) {
          this.log.error(`[${accessory.displayName}] Failed to get power state:`, err.message);
          return false;
        }
      })
      .onSet(async (value) => {
        try {
          if (value) {
            await this.command(playerid, ["play"]);
            if (this.debug) this.log.debug(`[${accessory.displayName}] Playing`);
          } else {
            await this.command(playerid, ["pause", "1"]);
            if (this.debug) this.log.debug(`[${accessory.displayName}] Paused`);
          }
        } catch (err) {
          this.log.error(`[${accessory.displayName}] Failed to set power:`, err.message);
        }
      });
    
    // Brightness characteristic (volume 0-100)
    lightbulbService
      .getCharacteristic(Characteristic.Brightness)
      .onGet(async () => {
        try {
          const result = await this.command(playerid, ["mixer", "volume", "?"]);
          if (result && result._volume !== undefined) {
            const volume = parseInt(result._volume);
            if (this.debug) this.log.debug(`[${accessory.displayName}] Volume: ${volume}`);
            return Math.max(0, Math.min(100, volume));
          }
          return 50;
        } catch (err) {
          this.log.error(`[${accessory.displayName}] Failed to get volume:`, err.message);
          return 50;
        }
      })
      .onSet(async (value) => {
        try {
          const clampedValue = Math.max(0, Math.min(100, value));
          await this.command(playerid, ["mixer", "volume", String(clampedValue)]);
          if (this.debug) this.log.debug(`[${accessory.displayName}] Set volume: ${clampedValue}`);
        } catch (err) {
          this.log.error(`[${accessory.displayName}] Failed to set volume:`, err.message);
        }
      });
  }
}
