'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'datos.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ajustes (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  api_hash TEXT UNIQUE,
  api_prefijo TEXT,
  dominios TEXT DEFAULT '',
  precio_entrada REAL,
  activo INTEGER DEFAULT 1,
  creado TEXT
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  titulo TEXT NOT NULL,
  fecha TEXT,
  cf_uid TEXT,
  rtmps_url TEXT, rtmps_key TEXT,
  srt_url TEXT, srt_id TEXT, srt_pass TEXT,
  grabar INTEGER DEFAULT 1,
  repeticion_horas INTEGER DEFAULT 48,
  activo INTEGER DEFAULT 1,
  creado TEXT
);
CREATE TABLE IF NOT EXISTS accesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  comprador TEXT NOT NULL,
  creado TEXT,
  primera_vista TEXT,
  ultima_vista TEXT,
  sesion TEXT,
  sesion_latido INTEGER,
  aperturas INTEGER DEFAULT 0,
  revocado INTEGER DEFAULT 0,
  UNIQUE (evento_id, comprador)
);
CREATE INDEX IF NOT EXISTS accesos_evento ON accesos(evento_id);
`);

const ajuste = (k, v) => {
  if (v === undefined) {
    const r = db.prepare('SELECT v FROM ajustes WHERE k = ?').get(k);
    return r ? r.v : null;
  }
  db.prepare('INSERT INTO ajustes (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
  return v;
};

module.exports = { db, ajuste };
