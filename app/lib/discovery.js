'use strict';

const fs = require('node:fs');
const path = require('node:path');

function unescapeMount(s) { return s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))); }

function readMounts(mountinfo='/proc/self/mountinfo') {
  let lines;
  try { lines = fs.readFileSync(mountinfo, 'utf8').split('\n'); } catch { return []; }
  return lines.map(line => {
    const cols = line.split(' '), dash = cols.indexOf('-');
    if (dash < 0 || cols.length < 9) return null;
    return { mount:unescapeMount(cols[4]), device:unescapeMount(cols[dash+2] || ''), fstype:cols[dash+1] };
  }).filter(Boolean);
}

function removableDevice(device) {
  const basename = path.basename(device);
  if (!device.startsWith('/dev/') || basename.startsWith('loop')) return false;
  const sd = basename.match(/^(sd[a-z]+)\d*$/);
  const mmc = basename.match(/^(mmcblk\d+)p?\d*$/);
  if (sd) {
    try {
      const resolved = fs.realpathSync(`/sys/class/block/${sd[1]}`);
      return resolved.includes('/usb');
    } catch { return false; }
  }
  if (mmc) {
    try { return fs.realpathSync(`/sys/class/block/${mmc[1]}`).includes('/mmc_host/'); }
    catch { return false; }
  }
  return false;
}

function findDCIM(folder) {
  try {
    const entries = fs.readdirSync(folder, {withFileTypes:true});
    return entries.find(ent => ent.isDirectory() && ent.name.toUpperCase() === 'DCIM') ? path.join(folder, entries.find(ent => ent.isDirectory() && ent.name.toUpperCase() === 'DCIM').name) : null;
  } catch { return null; }
}

function discoverSources(config, options={}) {
  const found = new Map();
  function addRoot(root, origin) {
    let real;
    try { real = fs.realpathSync(root); } catch { return; }
    if (!fs.statSync(real).isDirectory()) return;
    const dcim = findDCIM(real);
    if (dcim) found.set(real, {path:real, dcim, origin});
    if (!dcim) {
      try {
        for (const child of fs.readdirSync(real, {withFileTypes:true}).filter(e=>e.isDirectory() && !e.isSymbolicLink()).slice(0,20)) {
          const dir = path.join(real, child.name);
          const nested = findDCIM(dir);
          if (nested) found.set(dir, {path:dir, dcim:nested, origin});
        }
      } catch { /* unreadable mount */ }
    }
  }
  if (options.auto !== false) {
    for (const m of readMounts(options.mountinfo)) {
      if (!/^\/(vol0\d+|media|run\/media|mnt\/usb)(\/|$)/.test(m.mount)) continue;
      if (!removableDevice(m.device)) continue;
      addRoot(m.mount, 'USB/SD 自动发现');
    }
  }
  for (const root of config.sourceRoots || []) addRoot(root, '手动指定');
  return [...found.values()].sort((a,b)=>a.path.localeCompare(b.path));
}

module.exports = {readMounts, removableDevice, discoverSources, findDCIM};
