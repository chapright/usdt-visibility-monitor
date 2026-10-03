'use strict';

const bitpin = require('./bitpin');
const nobitex = require('./nobitex');
const ramzinex = require('./ramzinex');
const wallex = require('./wallex');
const tabdeal = require('./tabdeal');
const abantether = require('./abantether');
const saraf = require('./saraf');
const bit24 = require('./bit24');
const raastin = require('./raastin');
const kifpool = require('./kifpool');

/**
 * Every exchange under surveillance.
 *
 * Optional env overrides:
 *   EXCHANGES=bitpin,nobitex   restrict monitoring to these exchanges
 *   EXCHANGE_URL_BITPIN=...    point an exchange at a mirror or staging URL
 */
const ALL = [bitpin, nobitex, ramzinex, wallex, tabdeal, abantether, saraf, bit24, raastin, kifpool];

const only = (process.env.EXCHANGES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const EXCHANGES = (only.length ? ALL.filter((e) => only.includes(e.id)) : ALL).map((e) => {
  const override = process.env[`EXCHANGE_URL_${e.id.toUpperCase()}`];
  return override ? { ...e, url: override } : e;
});

const byId = new Map(EXCHANGES.map((e) => [e.id, e]));

module.exports = {
  EXCHANGES,
  get: (id) => byId.get(id),
  ids: () => EXCHANGES.map((e) => e.id),
};