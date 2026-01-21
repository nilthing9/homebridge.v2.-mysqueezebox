/**
 * homebridge-mysqueezebox-v2
 * LMS / Lyrion Music Server platform plugin
 * Auto-discovers all players and exposes them as Lightbulbs
 */

const axios = require("axios");

let Service, Characteristic, PlatformAccessory, UUIDGen;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  PlatformAccessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform(
    "homebridge-mysqueezebox-v2",
    "LMSPlatform",
    LMSPlatform
  );
};

class LMSPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.serverUrl = this.config.serverurl || "http://localhost:9000";
    this.pollInterval = (this.config.updateInterval || 10) * 1000;
    this.debug = !!this.config.debug;

    this.accessories = new Map();

    if (!api) return;

    api.on("didFinishLaunching", () => {
      this.log.info("LMS platform launched, discovering players…");
      this.discoverPlayers();
      setInterval(() => this.discoverPlayers(), this.pollInterval);
    });
  }

  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  async lmsRequest(params) {
    try {
      const res = await axios.post(
        `${this.serverUrl}/jsonrpc.js`,
        {
          id: 1,
          method: "slim.request",
          params,
        },
        { timeout: 3000 }
      );
      return res.data.result;
    } catch (err) {
      this.log.error("LMS request failed:", err.message);
      return null;
    }
  }

  async discoverPlayers() {
    const result = await this.lmsRequest(["", ["players", "0", "100"]]);
    if (!result || !result.players_loop) {
      this.log.warn("No LMS players found");
      return;
    }

    for (const player of result.players_loop) {
      const uuid = UUIDGen.generate(player.playerid);

      if (this.accessories.has(uuid)) continue;

      const accessory = new PlatformAccessory(player.name, uuid);
      accessory.context.player = player;
      this.setupAccessory(accessory);

      this.api.registerPlatformAccessories(
        "homebridge-mysqueezebox-v2",
        "LMSPlatform",
        [accessory]
      );

      this.accessories.set(uuid, accessory);
      this.log.info(`Added LMS player: ${player.name}`);
    }
  }

  setupAccessory(accessory) {
    const player = accessory.context.player;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, "Lyrion / Logitech")
      .setCharacteristic(Characteristic.Model, "Squeezebox Player")
      .setCharacteristic(Characteristic.SerialNumber, player.playerid);

    const service =
      accessory.getService(Service.Lightbulb) ||
      accessory.addService(Service.Lightbulb, player.name);

    service.getCharacteristic(Characteristic.On)
      .onGet(() => this.getPower(player))
      .onSet((value) => this.setPower(player, value));

    service.getCharacteristic(Characteristic.Brightness)
      .onGet(() => this.getVolume(player))
      .onSet((value) => this.setVolume(player, value));
  }

  async getPower(player) {
    const res = await this.lmsRequest([player.playerid, ["mode", "?"]]);
    return res === "play";
  }

  async setPower(player, value) {
    await this.lmsRequest([
      player.playerid,
      [value ? "play" : "pause"],
    ]);
  }

  async getVolume(player) {
    const res = await this.lmsRequest([
      player.playerid,
      ["mixer", "volume", "?"],
    ]);
    return parseInt(res || 0, 10);
  }

  async setVolume(player, value) {
    await this.lmsRequest([
      player.playerid,
      ["mixer", "volume", value],
    ]);
  }
}
