module.exports = function (RED) {
  "use strict";

  const discover = require("../lib/discover");
  const appliances = require("node-mideahvac");
  const path = require('path');
  const storage = require('node-persist');

  function MideaHVACConfig(config) {
    RED.nodes.createNode(this, config);

    let node = this;
    let options = {};

    node.ac = null;
    node.polling = null;

    node.updateStatus = function (obj) {
      node.emit("updateStatus", obj);
    };

    switch (config?.method) {
      case "serialbridge":
        options = {
          communicationMethod: "serialbridge",
          host: config?.shost,
          port: config?.sport,
        };
        break;
      case "osk103":
        options = {
          communicationMethod: "sk103",
          host: config?.chost,
          port: config?.cport,
          id: node.credentials?.id,
          key: node.credentials?.key,
          token: node.credentials?.token,
        };
        break;
      default:
    }

    try {
      if (!node.ac?._connection) {
        node.ac = appliances.createAppliance(options);
      }
    } catch (error) {
      node.updateStatus({ color: "red", text: "error" });
      node.error(error.message, error.stack);
      return;
    }

    node.ac.getStatus()
      .catch((error) => {
        node.updateStatus({ color: "red", text: "error" });
        node.error(error.message, error.stack);
      })
      .then(() => {
        node.updateStatus({ color: "green", text: "connected" });
      });

    // Start polling for status updates (each 60s)
    node.polling = setInterval(() => {
      node.ac.getStatus().catch((error) => {
        node.updateStatus({ color: "red", text: "error" });
        node.error(error.message, error.stack);
      });
    }, (config?.polling || 60) * 1000);

    node.ac.on("status-update", (data) => {
      node.emit("updateMessage", data);
    });

    // close
    node.on("close", () => {
      if (node.polling) {
        clearInterval(node.polling);
      }

      if (node.ac?._connection) {
        node.ac?._connection?.destroy();
      }
    });
  }

  RED.nodes.registerType("midea-hvac-config", MideaHVACConfig, {
    credentials: {
      username: { type: "text" },
      password: { type: "password" },
      id: { type: "text" },
      key: { type: "text" },
      token: { type: "text" },
    },
  });

  RED.httpAdmin.post("/midea-hvac/discover", async (req, res) => {
    let { nodeId, username, password, refresh} = req.body;
    refresh = refresh ? ["1", "yes", "true", "on"].includes(refresh.toLowerCase()) : false;

    if (refresh && (!password || password === "__PWRD__")) {
      password = RED.nodes.getNode(nodeId)?.credentials?.password;
    }

    try {
      // storage
      let userDir = path.join(require('os').homedir(), '.node-red');
      if (RED.settings.available() && RED.settings.userDir) {
        userDir = RED.settings.userDir;
      }
      await storage.init({ dir: path.resolve(userDir, 'midea-hvac') });

      if (refresh) {
        devices = await discover(username, password);
        await storage.set('devices', devices);
      } else {
        devices = await storage.get('devices');
      }
    } catch(error) {
      return res.json({ error: error });
    }

    return res.json(devices);
  });
};
