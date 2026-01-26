'use strict';

let Service, Characteristic;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;

  api.registerPlatform(
    'homebridge-mysqueezebox-v2',   // must match package.json name
    'LMSPlatform',                  // must match config.json platform
    LMSPlatform
  );
};

class LMSPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.log('LMSPlatform initialising...');
    this.log('Config:', this.config);

    if (api) {
      api.on('didFinishLaunching', () => {
        this.log('Homebridge finished launching.');
        this.discoverDevices();
      });
    }
  }

  discoverDevices() {
    this.log('Starting LMS auto-discovery...');

    if (this.config.autodiscover) {
      this.log('Auto-discovery enabled');
    }

    if (this.config.server) {
      this.log(`Using LMS server: ${this.config.server}`);
    }

    // placeholder — we’ll add LMS discovery logic next
  }
}
