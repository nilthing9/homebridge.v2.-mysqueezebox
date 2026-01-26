'use strict';

let Service, Characteristic, apiRef;

class LMSPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.log('LMSPlatform initialised');
  }

  configureAccessory(accessory) {}
}

module.exports = (api) => {
  apiRef = api;
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;

  api.registerPlatform(
    'homebridge-mysqueezebox-v2',   // package.json name
    'LMSPlatform',                  // config.json platform
    LMSPlatform
  );
};
