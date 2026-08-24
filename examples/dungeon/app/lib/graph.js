// The map, checked once and then answered from.
//
// `check` runs when this module is first imported, which is the moment the app
// starts. A map with an exit to a room that is not there is a broken game, and a
// broken game should not answer requests: it stops the dev server and stops the
// build, naming the room and the exit.
//
// The checks take the map rather than reading it, so a test can hand them a
// broken one. Called on the way past, they would only ever be tested by breaking
// the real map and putting it back.
//
// Module scope, so this happens once per isolate. Nothing reads a disk.

import { ITEMS, itemOf } from '../data/items.js';
import { ROOMS, START } from '../data/rooms.js';

/**
 * @typedef {import('../data/rooms.js').Room} Room
 * @typedef {import('../data/items.js').Item} Item
 */

/** The order exits are listed in, whichever order a room wrote them. */
export const DIRECTIONS = ['north', 'east', 'south', 'west', 'up', 'down'];

/** In the path and in `seen`, so an id has to survive being typed by hand. */
const ID = /^[a-z][a-z0-9-]*$/;

/** A door as an object, whichever way the room wrote it. */
function doorOf(exit) {
  if (typeof exit === 'string') return { room: exit, requires: null, locked: null };
  return { room: exit.room, requires: exit.requires ?? null, locked: exit.locked ?? null };
}

function refuse(message) {
  throw new Error(`dungeon map: ${message}`);
}

/** Every id is spelled the way a URL can carry, and no two rooms share one. */
function checkIds(rooms) {
  const seen = new Set();
  for (const room of rooms) {
    if (!ID.test(room.id)) refuse(`"${room.id}" is not a usable id: lowercase letters, digits and dashes`);
    if (seen.has(room.id)) refuse(`two rooms are called "${room.id}"`);
    seen.add(room.id);
  }
}

/** Two rooms in one cell would draw over each other on the minimap. */
function checkCells(rooms) {
  const taken = new Map();
  for (const room of rooms) {
    const cell = String(room.at);
    if (taken.has(cell)) refuse(`${room.id} and ${taken.get(cell)} are both at [${cell}]`);
    taken.set(cell, room.id);
  }
}

/** An exit names a direction and a room, and a door names an item and says so. */
function checkExits(rooms, byId, items) {
  for (const room of rooms) {
    for (const [dir, exit] of Object.entries(room.exits)) {
      if (!DIRECTIONS.includes(dir)) refuse(`${room.id} has an exit "${dir}", which is not a direction`);

      const door = doorOf(exit);
      if (!byId.has(door.room)) refuse(`${room.id} ${dir} leads to "${door.room}", which is not a room`);
      if (door.requires && !items.some((item) => item.id === door.requires)) {
        refuse(`${room.id} ${dir} needs "${door.requires}", which is not an item`);
      }
      if (door.requires && !door.locked) {
        refuse(`${room.id} ${dir} is locked and says nothing about it: give it \`locked\``);
      }
      if (door.locked && !door.requires) {
        refuse(`${room.id} ${dir} has lock text and no \`requires\`, so nothing ever opens it`);
      }
    }

    if (room.ending && Object.keys(room.exits).length) refuse(`${room.id} ends the run and has exits`);
    if (!room.ending && !Object.keys(room.exits).length) refuse(`${room.id} has no exits and does not end the run`);
  }
}

/** Every item is somewhere, and nowhere twice. */
function checkItems(rooms, items) {
  const placed = new Map();
  for (const room of rooms) {
    if (!room.item) continue;
    if (!items.some((item) => item.id === room.item.id)) {
      refuse(`${room.id} holds "${room.item.id}", which is not an item`);
    }
    if (placed.has(room.item.id)) refuse(`${room.item.id} is in ${placed.get(room.item.id)} and in ${room.id}`);
    placed.set(room.item.id, room.id);
  }
  for (const item of items) {
    if (!placed.has(item.id)) refuse(`${item.id} is not in any room, so nothing can pick it up`);
  }
}

/**
 * Walk the map the way a player has to walk it: a door stays shut until the item
 * that opens it has been picked up somewhere already reached.
 *
 * This is the check that catches a key locked behind the door it opens. A plain
 * walk that ignores locks calls that map fine.
 */
function reachable(byId, start) {
  const here = new Set([start]);
  const have = new Set();

  for (let grew = true; grew; ) {
    grew = false;
    for (const id of [...here]) {
      const room = byId.get(id);
      if (room.item && !have.has(room.item.id)) {
        have.add(room.item.id);
        grew = true;
      }
      for (const exit of Object.values(room.exits)) {
        const door = doorOf(exit);
        if (door.requires && !have.has(door.requires)) continue;
        if (here.has(door.room)) continue;
        here.add(door.room);
        grew = true;
      }
    }
  }
  return here;
}

function checkReachable(rooms, byId, start) {
  if (!byId.has(start)) refuse(`the run starts at "${start}", which is not a room`);

  const here = reachable(byId, start);
  const stranded = rooms.filter((room) => !here.has(room.id)).map((room) => room.id);
  if (stranded.length) {
    refuse(`${stranded.join(', ')} cannot be reached from ${start} by anyone carrying what the map allows`);
  }
  if (!rooms.some((room) => room.ending)) refuse('no room ends the run');
}

/**
 * Every claim the map makes, checked. Throws on the first thing that is wrong.
 *
 * @param {Room[]} rooms
 * @param {Item[]} items
 * @param {string} start
 * @returns {Map<string, Room>}
 */
export function check(rooms, items, start) {
  const byId = new Map(rooms.map((room) => [room.id, room]));

  checkIds(rooms);
  checkCells(rooms);
  checkExits(rooms, byId, items);
  checkItems(rooms, items);
  checkReachable(rooms, byId, start);

  return byId;
}

const byId = check(ROOMS, ITEMS, START);

/**
 * The room with this id, or null. Anything else is a URL somebody typed.
 *
 * @param {string} [id]
 * @returns {Room | null}
 */
export function roomOf(id) {
  return byId.get(String(id ?? '').toLowerCase()) ?? null;
}

/**
 * What is lying in this room, as an item, or null.
 *
 * The map check has already refused a room holding something that is not an
 * item, so the second `null` here is a fact about the type rather than about the
 * game.
 *
 * @param {Room} room
 * @returns {(Item & { line: string }) | null}
 */
export function itemIn(room) {
  if (!room.item) return null;

  const item = itemOf(room.item.id);
  if (!item) return null;

  return { ...item, line: room.item.line };
}

/** Every room, in map order. The minimap draws the ones a run has seen. */
export const rooms = ROOMS;

/**
 * The ways out of a room, in compass order.
 *
 * `passable` is the whole of it: a passable exit is rendered as a link and a shut
 * one as text, so the template never has both to decide between and no request
 * has to be refused.
 *
 * @param {Room} room
 * @param {string[]} have items this run is carrying
 */
export function exitsFrom(room, have) {
  const out = [];
  for (const dir of DIRECTIONS) {
    const exit = room.exits[dir];
    if (!exit) continue;

    const door = doorOf(exit);
    const to = roomOf(door.room);
    const passable = !door.requires || have.includes(door.requires);

    out.push({
      dir,
      room: door.room,
      // The map check refused an exit to a room that is not there, so the
      // fallback is unreachable and the type wants it anyway.
      title: to ? to.title : door.room,
      passable,
      locked: passable ? null : door.locked,
    });
  }
  return out;
}
