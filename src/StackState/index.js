const log = require('/log')
const otherStates = [
  require('./state.scout'),
  require('./state.worker'),
  require('./state.builder'),
  require('./state.claimer'),
  require('./state.miner')
]
const states = ({
  get log () {
    return log
  },
  get stack () {
    return this.creep.memory.stack
  },
  runCreep (creep, baseState = ['scout']) {
    creep.memory.stack = creep.memory.stack || [creep.memory.role || baseState]
    this.creep = creep
    this.runStack()
  },
  runStack () {
    if (typeof this.stack[0] === 'string') this.creep.memory.stack = [this.stack]
    const [[name, ...args] = []] = this.stack.slice(-1) || []
    this.log.debug(() => `runStack: ${name}`)
    const func = this[name]
    if (func) {
      func.apply(this, args)
    } else {
      this.log.error(`Invalid state ${name}`)
    }
  },
  push (...arg) {
    this.stack.push(arg)
  },
  pop () {
    this.stack.pop()
  },
  idle () {},
  noop () {
    this.pop()
  },
  idle (say = 'Idling') {
    this.say(say)
  },
  sleep (until = 0) {
    if (Game.time >= until) {
      this.pop()
      this.runStack()
    }
  },
  loop (states, count = 1) {
    this.pop()
    if (--count > 0) {
      this.push('loop', states, count)
    }
    eachRight(states, state => this.push(...state))
    this.runStack()
  },
  repeat (count, ...state) {
    this.pop()
    if (count > 0) {
      this.push('repeat', --count, ...state)
    }
    this.push(...state)
    this.runStack()
  },
  resolveTarget (tgt) {
    if (!tgt) return tgt
    if (typeof tgt === 'string') {
      return Game.getObjectById(tgt)
    }
    if (tgt.roomName && !(tgt instanceof RoomPosition)) {
      return new RoomPosition(tgt.x, tgt.y, tgt.roomName || tgt.room)
    }
    return tgt
  },
  say (say, publ = false) {
    this.creep.say(say, publ)
    this.pop()
    this.runStack()
  },
  suicide () {
    this.creep.suicide()
    this.pop()
  },
  move (dir) {
    this.creep.move(dir)
    this.pop()
  },
  moveOntoExit (exitDir) {
    const exit = this.creep.pos.findClosestByRange(exitDir)
    const dir = this.creep.pos.getDirectionTo(exit)
    this.creep.move(dir)
    this.pop()
  },
  travelTo (target, opts = {}) {
    if (typeof opts.roomCallback === 'string') {
      opts.roomCallback = new Function(opts.roomCallback)
    }
    const tgt = this.resolveTarget(target)
    if (!tgt) return this.pop()
    if (this.creep.pos.isEqualTo(tgt.pos || tgt)) {
      this.pop()
      this.runStack()
    } else {
      this.creep.travelTo(tgt, opts)
    }
  },
  moveNear (target, opts = {}) {
    if (typeof opts.roomCallback === 'string') {
      opts.roomCallback = new Function(opts.roomCallback)
    }
    const tgt = this.resolveTarget(target)
    if (!tgt) this.pop()
    if (this.creep.pos.isNearTo(tgt)) {
      this.pop()
      this.runStack()
    } else {
      this.creep.travelTo(tgt, opts)
    }
  },
  moveInRange (target, range, opts = {}) {
    const tgt = this.resolveTarget(target)

    if (!tgt || this.creep.pos.inRangeTo(tgt, range)) {
      this.pop()
      this.runStack()
    } else {
      this.creep.travelTo(tgt, opts)
    }
  },
  moveToRoom (target, opts = {}) {
    if (typeof target === 'string' && target.match(/^[EW]\d+[NS]\d+$/)) {
      target = { x: 25, y: 25, roomName: target }
    }
    const tgt = this.resolveTarget(target)
    if (this.creep.pos.roomName === tgt.roomName) {
      const exits = this.creep.room.find(FIND_EXIT)
      this.pop()
      this.push('flee', exits.map(e => ({ pos: e, range: 1 })))
      this.runStack()
    } else {
      this.creep.travelTo(tgt, opts)
    }
  },
  flee (targets) {
    if (!Array.isArray(targets)) {
      return this.pop()
    }
    targets = targets.filter(t => !!t && (t.range && t.pos))
    if (targets.length === 0) {
      log.alert(`Aborting broken flee ${JSON.stringify(targets)}`)
      return this.pop()
    }
    const { path } = PathFinder.search(this.creep.pos, targets, {
      flee: true,
      roomCallback (room) {
        const cm = new PathFinder.CostMatrix()
        for (let i = 0; i < 2500; i++) {
          cm._bits[i] = 0
        }
        const r = Game.rooms[room]
        if (r) {
          r.structures.all.forEach(({ structureType, pos: { x, y } }) => {
            if (OBSTACLE_OBJECT_TYPES.includes(structureType)) {
              cm.set(x, y, 254)
            }
          })
        }
        return cm
      }
    })
    if (path && path.length) {
      this.creep.moveByPath(path)
    }
    this.pop()
  },
  store (res, cache = {}) {
    if (!cache.work) {
      cache.work = this.creep.getActiveBodyparts(C.WORK)
    }
    if (!this.creep.carry[res]) {
      this.pop()
      return this.runStack()
    }
    if (cache.work) {
      const road = this.creep.pos.lookFor(C.LOOK_STRUCTURES).find(s => s.structureType === C.STRUCTURE_ROAD)
      if (road && road.hits <= road.hitsMax < 100) {
        this.creep.repair(road)
      }
      const cs = this.pos.lookFor(C.LOOK_CONSTRUCTION_SITES).find(s => s.structureType === C.STRUCTURE_ROAD)
      if (cs) {
        return this.build(cs)
      }
    }
    const tgt = this.creep.room.storage || this.creep.room.fakeStorage || (res === C.RESOURCE_ENERGY && this.creep.room.spawns.find(s => s.energy < s.energyCapacity))
    if (tgt) {
      this.push('transfer', tgt.id, res)
      this.push('moveNear', tgt.id)
      return this.runStack()
    }
  },
  revTransfer (target, res = RESOURCE_ENERGY, amt) {
    const tgt = this.resolveTarget(target)
    if (tgt) {
      tgt.transfer(this.creep, res, amt)
    }
    this.pop()
  }
})
module.exports = states

for (const state of otherStates) {
  Object.assign(states, state)
}

const funcsToWrap = ['attack', 'rangedAttack', 'heal', 'upgradeController', 'claimController', 'reserveController', 'attackController', 'signController', 'moveTo', 'build', 'harvest', 'repair', 'pickup', 'withdraw', 'transfer']
funcsToWrap.forEach(wrap)

function wrap (func) {
  states[func] = function (target, ...args) {
    const tgt = this.resolveTarget(target)
    if (tgt) {
      const fn = this.creep[func]
      fn.call(this.creep, tgt, ...args)
    }
    this.pop()
  }
  states[func + 'R'] = function (target, ...args) {
    const tgt = this.resolveTarget(target)
    if (tgt) {
      const fn = this.creep[func]
      fn.call(this.creep, tgt, ...args)
    }
    this.pop()
    this.runStack()
  }
}
