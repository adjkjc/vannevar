// Description:
//   Help with timezones.
//
// Commands:
//   hubot time - Print time in a set of default timezones
//   hubot time in <loc> - Print time in the specified location (free text, geocoded)
//   hubot time for <name> - Print time for the specified user (according to their Slack profile)
//

'use strict';

var Promise = require('promise');
var geocoder = require('geocoder');
var timezoner = require('timezoner');

var DEFAULT_TIMEZONES = {
    "Pacific": [37.7833, -122.4167],  // San Francisco
    "Central": [41.836944, -87.684722],  // Chicago
    "Eastern": [40.7127, -74.0059],  // NYC
    "UK": [51.507222, -0.1275],  // London
    "Berlin": [52.5167, 13.3833]
};


var geocode = Promise.denodeify(geocoder.geocode.bind(geocoder));
var getTimeZone = Promise.denodeify(timezoner.getTimeZone);

function utcNow () {
    return Math.round((new Date()).getTime() / 1000);
}

function pad (num) {
    if (num < 10) {
        return '0' + num;
    } else {
        return '' + num;
    }
}

function getOffsetTime (offset) {
    var d = new Date((utcNow() + offset) * 1000);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}

function fetchLocation (name) {
    // Shortcut for a name that matches one of our default timezones
    if (name in DEFAULT_TIMEZONES) {
        var ref = DEFAULT_TIMEZONES[name],
            lat = ref[0],
            lng = ref[1];

        return {
            query: name,
            lat: lat,
            lng: lng,
            address: name + " @ " + lat + ", " + lng
        };
    }

    return geocode(name).then(function (data) {
        if (data.status === 'OK') {
            return {
                query: name,
                lat: data.results[0].geometry.location.lat,
                lng: data.results[0].geometry.location.lng,
                address: data.results[0].formatted_address
            };
        } else {
            throw new Error('geocoding failed (' + data.status + ')');
        }
    });
}

function fetchTimezone (loc) {
    return getTimeZone(loc.lat, loc.lng).then(function (data) {
        if (data.status === 'OK') {
            return data;
        } else {
            throw new Error('timezone lookup failed (' + data.status + ')');
        }
    });
}

function lookup (query) {
    var result = {};
    var promise = Promise.resolve(fetchLocation(query));
    return promise.then(function (loc) {
        result.loc = loc;
        return fetchTimezone(loc);
    }).then(function (tz) {
        result.tz = tz;
        return result;
    });
}

function lookupDefault(msg) {
    var timezones = Object.keys(DEFAULT_TIMEZONES);
    return Promise.all(timezones.map(function(tz) {
        return lookup(tz);
    }));
}

function renderCurrentTime(tz) {
    return getOffsetTime(tz.dstOffset + tz.rawOffset);
}

function renderMessage(loc, tz) {
    var msg = renderCurrentTime(tz);
    if (loc.address) {
        msg += ' (' + loc.address + ')';
    }
    return msg;
}

module.exports = function(robot) {

    robot.respond(/times?$/i, function(msg) {
        lookupDefault().done(function(results) {
            var strings = results.map(function(res) {
                return res.loc.query + ': ' + renderCurrentTime(res.tz);
            });
            msg.send(strings.join(', '));
        });
    });

    robot.respond(/time in (.+)$/i, function(msg) {
        var query = msg.match[1];
        lookup(query).done(function(res) {
            msg.send(renderMessage(res.loc, res.tz));
        }, function(err) {
            msg.send('Sorry, no idea: ' + err.message);
        });
    });

    robot.respond(/time for @?(\S+)$/i, function(msg) {
        const username = msg.match[1];
        if (robot.adapterName !== "slack") {
            msg.send('Sorry, this only works on Slack.');
            return;
        }
        const user = robot.adapter.client.rtm.dataStore.getUserByName(username);
        if (!user) {
            msg.send(`Sorry, I don't know who ${username} is.`);
            return;
        }
        if (typeof user.tz_offset != 'number') {
            msg.send(`Sorry, I don't know what timezone ${username} is in. ` +
                     `Maybe ask them to update their Slack profile?`);
            return;
        }

        let response = getOffsetTime(user.tz_offset);
        if (user.tz_label) {
            response += ` (${user.tz_label})`;
        }
        msg.send(response);
    });

};
