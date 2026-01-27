# homebridge-mysqueezebox
This Homebridge-LMS is an attempt to update this plugin to modern standards, ready for HomeBridge V2. Thanks to the work of others in the past: [Homebridge](https://github.com/nfarina/homebridge) and plugin for sending commands to your Squeezebox or, as it is now known, Lyrion Media Server. 

This plugin exposes a Squeezebox/LMS as one or more HomeKit accessories which look like dimmable lightbulbs.  AppleHomekit doesn't seem to support smart speakers fully yet. So until they do, this is an acceptable alternative. Turning on a “light” starts something playing with an `oncommand`, and by turning the "light" off, will turn off . The script should detect any endpoint e.g. PiCorePlayer.  With Siri, it's relatively natural to say “Turn on *thing I want to listen to*”, and you can easily incorporate the Squeezebox in HomeKit scenes, for example if you want music to wake up/go to sleep by.  Adjust the lightbulb's brightness to control the Squeezebox’s playback volume. In my case, I turn my music player off automagically when I turn on the TV. 

As Lyrion Media server is now local only, `playerid` is the MAC address of your LMS server, which you can find in the Player &gt; General section of MySqueezebox, or Settings &gt; Information on Logitech Media Server.

## Sample usage

Here are some anonymised snippets from my Homebridge `config.json`:

### LMS
```
    "accessories": [
        {
            "accessory": "MySqueezebox",
            "name": "Bedroom Line In",
            "playerid": "PLAYERID",
            "oncommand": ["setlinein", "linein"],
        },
        {
            "accessory": "MySqueezebox",
            "name": "Bedroom Radio Paradise",
            "playerid": "PLAYERID",
            "oncommand": ["playlist","play","http://stream-dc1.radioparadise.com/mp3-192","Radio Paradise"],
            "email": "EMAIL",
            "password": "PASSWORD"
        },
```

### Logitech Media Server
```
    "accessories": [
        {
            "accessory": "MySqueezebox",
            "name": "Bedroom Line In",
            "playerid": "PLAYERID",
            "oncommand": ["setlinein", "linein"],
            "serverurl": "http://USERNAME:PASSWORD@LMSHOST:LMSPORT"
        },
        {
            "accessory": "MySqueezebox",
            "name": "Bedroom Radio Paradise",
            "playerid": "PLAYERID",
            "oncommand": ["playlist","play","http://stream-dc1.radioparadise.com/mp3-192","Radio Paradise"],
            "serverurl": "http://USERNAME:PASSWORD@LMSHOST:LMSPORT"
        },
```

If you're trying to figure out what to include for an `oncommand`, the JSON RPC interface used by this plugin is quite similar to the Logitech Media Server command-line interface; [this](http://htmlpreview.github.io/?https://github.com/Logitech/slimserver/blob/public/7.9/HTML/EN/html/docs/cli-api.html#Supported%20Commands) is a good reference.
