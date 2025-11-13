/**
 * Homebridge-MySqueezebox v2 – Improved Version
 * Author: nilthing9
 * Features: Homebridge v2, async/await, axios, debug toggle, config validation
 */

const axios = require("axios");

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-mysqueezebox-v2", "MySqueezebox", MySqueezeboxAccessory);
};

class MySqueezeboxAccessory {
  constructor(log, config) {
    this.log = log;

    // Config validation
    if (!config.name || !config.playerid) {
      this.log.error("MySqueezebox config missing required fields: name or playerid");
    }

    this.name = config.name || "Squeezebox";
    this.email = config.email || "";
    this.password = config.password || "";
    this.playerid = config.playerid;
    this.oncommand = config.oncommand || ["power", "1"];
    this.offcommand = config.offcommand || ["power", "0"];
    this.serverurl = config.serverurl || "http://mysqueezebox.com";
    this.mysqueezebox = config.serverurl === undefined;
    this.debug = config.debug || false;
    this.cookie = null; // store login cookie

    this.service = new Service.Lightbulb(this.name);

    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    this.service
      .getCharacteristic(Characteristic.Brightness)
      .onGet(this.getBrightness.bind(this))
      .onSet(this.setBrightness.bind(this));
  }

  async login() {
    if (!this.mysqueezebox) return;

    if (this.cookie) return; // already logged in

    try {
      const response = await axios.post(`${this.serverurl}/user/login`, null, {
        params: { email: this.email, password: this.password },
        timeout: 3000,
      });
      if (response.headers["set-cookie"]) {
        this.cookie = response.headers["set-cookie"];
        if (this.debug) this.log.debug("Logged into MySqueezebox, cookie stored");
      }
    } catch (err) {
      this.log.error("Login failed:", err.message);
      throw new Error("Failed to log into MySqueezebox");
    }
  }

  async command(cmd) {
    await this.login();

    try {
      const rpc = { id: 1, method: "slim.request", params: [this.playerid, cmd] };
      const response = await axios.post(`${this.serverurl}/jsonrpc.js`, rpc, {
        timeout: 3000,
        headers: { Cookie: this.cookie ? this.cookie.join("; ") : "" },
      });
      if (this.debug) this.log.debug("Squeezebox command response:", response.data);
      return response.data.result;
    } catch (err) {
      this.log.error("Squeezebox command error:", err.message);
      throw err;
    }
  }

  async getOn() {
    if (this.debug) this.log.debug("Getting power state...");
    const result = await this.command(["status"]);
    return result && result.mode === "play";
  }

  async setOn(value) {
    if (this.debug) this.log.debug("Setting power:", value);
    await this.command(value ? this.oncommand : this.offcommand);
  }

  async getBrightness() {
    if (this.debug) this.log.debug("Getting volume...");
    const result = await this.command(["mixer", "volume", "?"]);
    return result ? parseInt(result._volume) : 0;
  }

  async setBrightness(value) {
    if (this.debug) this.log.debug("Setting volume:", value);
    await this.command(["mixer", "volume", String(value)]);
  }

  getServices() {
    return [this.service];
  }
}
