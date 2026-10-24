'use strict';
var fs = require('fs');
var path = require('path');
var Client = require('pg').Client;

function config(database) {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: +(process.env.PGPORT || 5432),
    user: process.env.PGUSER || process.env.USER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: database
  };
}

async function withDb(fn) {
  var name = 'duo_spend_' + process.pid + '_' + Date.now();
  var admin = new Client(config('postgres'));
  await admin.connect();
  await admin.query('create database ' + name);
  await admin.end();
  var c = new Client(config(name));
  await c.connect();
  try {
    var root = path.join(__dirname, '..');
    await c.query(fs.readFileSync(path.join(root, 'test', 'baseline.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(root, 'migrations', '20261024_spend_entries.sql'), 'utf8'));
    if (process.env.DUO_STUB_EXPOSED === '1') {
      await c.query('grant usage on schema public to anon');
      await c.query('revoke all on table public.spend_entries from anon');
    }
    await c.query(fs.readFileSync(path.join(root, 'verify.sql'), 'utf8'));
    await fn(c);
  } finally {
    await c.end();
    var drop = new Client(config('postgres'));
    await drop.connect();
    await drop.query('drop database ' + name + ' with (force)');
    await drop.end();
  }
}

async function asRole(c, uid, role, fn) {
  if (uid) await c.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', uid]);
  await c.query('set role ' + role);
  try {
    return await fn();
  } finally {
    await c.query('reset role');
  }
}

function fail(p) {
  return p.then(function () { throw new Error('expected the statement to fail'); }, function (e) { return e; });
}

module.exports = { withDb: withDb, asRole: asRole, fail: fail };
