/**
 * Homebridge-MySqueezebox v2 compatible
 * Updated for Homebridge v2 and Node 18+
 * Maintainer: nilthing9
 */

const requestBase = require("request");
const jar = requestBase.jar();
const request = requestBase.defaults({ jar, followRedirect: false, timeout: 1000 });

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-mysqueezebox", "MySqueezebox", MySqueezeboxAccessory);
};

function MySqueezeboxAccessory(log, config) {
  this.log = log;
  this.name = config["name"];
  this.email = config["email"];
  this.password = config["password"];
  this.playerid = config["playerid"];
  this.oncommand = config["oncommand"];
  this.offcommand = config["offcommand"] || ["power", "0"];
  this.serverurl = config["serverurl"] || "http://mysqueezebox.com";
  this.mysqueezebox = config["serverurl"] === undefined;

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

MySqueezeboxAccessory.prototype.login = function (callback) {
  if (!this.mysqueezebox) {
    callback(null);
    return;
  }

  // Skip login if cookie already set
  if (jar.getCookieString("http://mysqueezebox.com")) {
    callback(null);
    return;
  }

  request.get(
    "http://mysqueezebox.com/user/login",
    { form: { email: this.email, password: this.password } },
    (err, response, body) => {
      if (!err) {
        this.log.debug(jar.getCookieString("http://mysqueezebox.com"));
        callback(null);
      } else {
        this.log.error("MySqueezebox error '%s'. Response: %s", err, body);
        callback(err || new Error("Failed to log into MySqueezebox."));
      }
    }
  );
};

MySqueezeboxAccessory.prototype.command = function (command, callback) {
  const rpc = { id: 1, method: "slim.request", params: [this.playerid, command] };

  request.post(
    {
      url: this.serverurl + "/jsonrpc.js",
      json: rpc,
    },
    (err, response, body) => {
      if (!err && response.statusCode === 200 && response.headers["content-type"].includes("application/json")) {
        this.log.info("Squeezebox JSON RPC complete: " + JSON.stringify(rpc));
        callback(null, body.result);
      } else {
        this.log.error("Squeezebox error '%s'. Response: %s", err, body);
        callback(err || new Error("MySqueezebox error occurred."));
      }
    }
  );
};

MySqueezeboxAccessory.prototype.getOn = async function () {
  this.log.debug("Checking if Squeezebox is on...");
  return new Promise((resolve, reject) => {
    this.login((status) => {
      if (status) return reject(status);

      this.command(["status"], (status, result) => {
        if (status) return reject(status);
        if (!result) return reject(new Error("Could not get Squeezebox power status."));
        const isOn = result.mode === "play";
        this.log.debug("Power state: " + (isOn ? "ON" : "OFF"));
        resolve(isOn);
      });
    });
  });
};

MySqueezeboxAccessory.prototype.setOn = async function (on) {
  this.log.debug("Setting Squeezebox on: " + on);
  return new Promise((resolve, reject) => {
    this.login((status) => {
      if (status) return reject(status);

      const onoff = (status) => {
        if (status) return reject(status);
        this.command(on ? this.oncommand : this.offcommand, (err) => {
          if (err) reject(err);
          else resolve();
        });
      };

      if (on) this.command(["power", "1"], onoff);
      else onoff(null);
    });
  });
};

MySqueezeboxAccessory.prototype.getBrightness = async function () {
  this.log.debug("Getting Squeezebox volume...");
  return new Promise((resolve, reject) => {
    this.login((status) => {
      if (status) return reject(status);

      this.command(["mixer", "volume", "?"], (status, result) => {
        if (status) return reject(status);
        if (!result) return reject(new Error("Could not get Squeezebox volume."));
        const volume = parseInt(result._volume);
        this.log.debug("Volume is " + volume);
        resolve(volume);
      });
    });
  });
};

MySqueezeboxAccessory.prototype.setBrightness = async function (value) {
  this.log.debug("Setting Squeezebox volume: " + value);
  return new Promise((resolve, reject) => {
    this.login((status) => {
      if (status) return reject(status);

      this.command(["mixer", "volume", String(value)], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
};

MySqueezeboxAccessory.prototype.getServices = function () {
  return [this.service];
};
