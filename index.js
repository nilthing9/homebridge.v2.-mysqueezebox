'use strict';

const axios = require('axios');

let Service, Characteristic, UUIDGen, Categories;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  UUIDGen = api.hap.uuid;
  Categories = api.hap.Categories;

  api.registerPlatform(
    'homebridge-lms',
    'LMSPlatform',
    LMSPlatform
  );
};

class LMSPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.host = config.host || '192.168.0.25';
    this.port = config.port || 9000;
    this.baseUrl = `http://${this.host}:${this.port}`;

    this.pollInterval = config.pollInterval || 15000;

    // Map<playerid, accessory>
    this.accessories = new Map();
    this.statusTimers = new Map();

    this.log(`LMS Platform initialised at ${this.baseUrl}`);

    api.on('didFinishLaunching', () => {
      this.log('LMS Platform finished launching');
      this.discoverPlayers();
      this.pollTimer = setInterval(
        () => this.discoverPlayers(),
        this.pollInterval
      );
    });
  }

  /* ---------- Cached accessories ---------- */
  configureAccessory(accessory) {
    let playerid = accessory.context?.playerid;
    if (!playerid) {
      this.log.warn(`Cached accessory ${accessory.displayName} missing playerid`);
      return;
    }

    playerid = playerid.toLowerCase().trim();
    accessory.context.playerid = playerid;

    this.log(`Loaded cached accessory: ${accessory.displayName}`);
    this.accessories.set(playerid, accessory);

    this.setupAccessory(accessory);
  }

  /* ---------- Discovery ---------- */
  async discoverPlayers() {
    try {
      const data = await this.lmsRequest('', ['players', 0, 50]);
      const players = data?.result?.players_loop || [];

      this.log.debug(`Discovered ${players.length} LMS player(s)`);

      for (const player of players) {
        if (!player.playerid || !player.name) continue;
        this.ensureAccessory(player);
      }
    } catch (err) {
      this.log.error(`Failed to discover players: ${err.message}`);
    }
  }

  ensureAccessory(player) {
    const playerid = player.playerid.toLowerCase().trim();

    // THIS is the critical guard
    if (this.accessories.has(playerid)) {
      return;
    }

    const uuid = UUIDGen.generate(`homebridge-lms:${playerid}`);
    this.log(`Registering new accessory for ${player.name}`);

    const accessory = new this.api.platformAccessory(player.name, uuid);
    accessory.context.playerid = playerid;
    accessory.category = Categories.FAN;

    this.accessories.set(playerid, accessory);
    this.setupAccessory(accessory);

    this.api.registerPlatformAccessories(
      'homebridge-lms',
      'LMSPlatform',
      [accessory]
    );
  }

  /* ---------- Accessory setup ---------- */
  setupAccessory(accessory) {
    const playerid = accessory.context.playerid;

    /* Accessory Information */
    let infoService = accessory.getService(Service.AccessoryInformation);
    if (!infoService) {
      infoService = accessory.addService(Service.AccessoryInformation);
    }

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'Logitech')
      .setCharacteristic(Characteristic.Model, 'Squeezebox / LMS')
      .setCharacteristic(Characteristic.SerialNumber, playerid)
      .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0');

    /* Fanv2 Service */
    let fanService = accessory.getService(Service.Fanv2);
    if (!fanService) {
      fanService = accessory.addService(Service.Fanv2, accessory.displayName);
    }

    /* Active → Play / Pause */
    fanService.getCharacteristic(Characteristic.Active)
      .onGet(async () => {
        try {
          const data = await this.lmsRequest(playerid, ['mode', '?']);
          return data?.result?._mode === 'play'
            ? Characteristic.Active.ACTIVE
            : Characteristic.Active.INACTIVE;
        } catch {
          return Characteristic.Active.INACTIVE;
        }
      })
      .onSet(async (value) => {
        try {
          await this.lmsRequest(
            playerid,
            [value === Characteristic.Active.ACTIVE ? 'play' : 'pause']
          );
        } catch {}
      });

    /* RotationSpeed → Volume */
    fanService.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(async () => {
        try {
          const data = await this.lmsRequest(playerid, ['mixer', 'volume', '?']);
          return parseInt(data?.result?._volume) || 0;
        } catch {
          return 0;
        }
      })
      .onSet(async (value) => {
        try {
          await this.lmsRequest(
            playerid,
            ['mixer', 'volume', Math.round(value)]
          );
        } catch {}
      });

    this.startPolling(accessory);
  }

  /* ---------- Status polling ---------- */
  startPolling(accessory) {
    const playerid = accessory.context.playerid;

    if (this.statusTimers.has(playerid)) {
      clearInterval(this.statusTimers.get(playerid));
    }

    const fanService = accessory.getService(Service.Fanv2);
    if (!fanService) return;

    const timer = setInterval(async () => {
      try {
        const data = await this.lmsRequest(playerid, ['status', '-', 1]);
        const result = data?.result;
        if (!result) return;

        fanService.getCharacteristic(Characteristic.Active)
          .updateValue(
            result.mode === 'play'
              ? Characteristic.Active.ACTIVE
              : Characteristic.Active.INACTIVE
          );

        if (result['mixer volume'] !== undefined) {
          fanService.getCharacteristic(Characteristic.RotationSpeed)
            .updateValue(parseInt(result['mixer volume']));
        }
      } catch {
        // never break Homebridge
      }
    }, 5000);

    this.statusTimers.set(playerid, timer);
  }

  /* ---------- LMS RPC ---------- */
  async lmsRequest(playerid, command) {
    const payload = {
      id: 1,
      method: 'slim.request',
      params: [playerid, command]
    };

    const response = await axios.post(
      `${this.baseUrl}/jsonrpc.js`,
      payload,
      { timeout: 5000 }
    );

    return response.data;
  }
}
