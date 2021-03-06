// import config from '/etc/stats'
import { Logger } from '/log'
import C from './constants'
/* USAGE:
Configure CONFIG below
At VERY top of main.js:
> const stats = require('stats')

At top of loop():
> stats.reset()

At bottom of loop():
> stats.commit()

to add a stat, just call
> stats.addSimpleStat(key,value)
or more advanced
> stats.addStat('scheduler',{ queue: 1 },{ count: 5, max: 5, min: 2, amount: 3 })

Tags (second argument) should not contain data that varies a lot, for example, don't
put stuff like object ids in tags doing so ends up causing massive performance hits
as the tag indexes get too large too quickly. Good data for tags is more static stuff
such as roomName, sectorName, etc, low overall spread.

*/
const config = {
  output: [
    {
      driver: 'Prometheus',
      types: ['segment'],
      segment: 98
    },
    {
      driver: 'Graphite', // Graphite, InfluxDB
      format: 'plain',
      segment: 99, 
      types: ['memory', 'segment'],
      key: '__stats',
    }
  ],
  format: 'plain', // Or JSON, only applies to Graphite driver
  types: ['memory', 'segment', 'console'], // memory, segment, console (the agent limits memory and segment to 15 second poll intervals)
  key: '__stats',
  segment: 99,
  baseStats: true,
  measureMemoryParse: false,
  usermap: { // use module.user in console to get userID for mapping. Defaults to username of Spawn1 if not defined
    // '577bc02e47c3ef7031adb268': 'ags131',
  }
}

const DRIVER_DEF = {
  driver: 'Graphite',
  types: ['memory'], // memory, segment, console
  key: '__stats'
}

const CONFIG = {
  driver: 'Graphite',
  types: ['memory'], // memory, segment, console
  key: '__stats',
  ticksToKeep: 20,
  segmentBase: 30,
  baseStats: true,
  measureMemoryParse: true,
  divider: ';', // "\n",
  usermap: { // use module.user in console to get userID for mapping.
    // '577bc02e47c3ef7031adb268': 'ags131',
  }
}

export class InfluxDB {
  get mem () {
    Memory[this.opts.key] = Memory[this.opts.key] || { index: 0, last: 0 }
    return Memory[this.opts.key]
  }

  register () {}

  pretick () {
    this.reset()
  }

  posttick () {
    this.commit()
  }

  constructor (opts = {}) {
    this.opts = Object.assign(CONFIG, opts)
    this.log = new Logger('stats')
    global.influxdb = this
    this.reset()
    this.startTick = Game.time
    this.shard = (Game.shard && Game.shard.name) || 'unknown'
    this.user = C.USER // _.find(Game.spawns, v => v).owner.username
  }

  reset () {
    if (Game.time === this.startTick) return // Don't reset on new tick
    this.stats = []
    this.cpuReset = Game.cpu.getUsed()

    if (!this.opts.measureMemoryParse) return
    const start = Game.cpu.getUsed()
    if (this.lastTime && global.LastMemory && Game.time === (this.lastTime + 1)) {
      delete global.Memory
      global.Memory = global.LastMemory
      RawMemory._parsed = global.LastMemory
      this.log.info('Tick has same GID!')
    } else {
      Memory // eslint-disable-line no-unused-expressions
      global.LastMemory = RawMemory._parsed
    }
    this.lastTime = Game.time
    const end = Game.cpu.getUsed()
    const el = end - start
    this.memoryParseTime = el
    this.addStat('memory', {}, {
      parse: el,
      size: RawMemory.get().length
    })
    this.endReset = Game.cpu.getUsed()
    this.log.info(`Entry: ${this.cpuReset.toFixed(3)} - Exit: ${(this.endReset - this.cpuReset).toFixed(3)} - Mem: ${this.memoryParseTime.toFixed(3)} (${(RawMemory.get().length / 1024).toFixed(2)}kb)`)
  }

  addSimpleStat (name, value = 0) {
    this.addStat(name, {}, { value })
  }

  addStat (name, tags = {}, values = {}) {
    this.stats.push({ name, tags, values })
  }

  addBaseStats () {
    this.addStat('time', {}, {
      tick: Game.time,
      timestamp: Date.now(),
      duration: Memory.lastDur,
      globalUptime: Game.time - this.startTick
    })
    this.addStat('gcl', {}, {
      level: Game.gcl.level,
      progress: Game.gcl.progress,
      progressTotal: Game.gcl.progressTotal,
      progressPercent: (Game.gcl.progress / Game.gcl.progressTotal) * 100
    })
    this.addStat('market', {}, {
      credits: Game.market.credits
    })
    _.each(Game.rooms, room => {
      const { controller, storage, terminal } = room
      if (!controller || !controller.my) return
      this.addStat('room', {
        room: room.name
      }, {
        level: controller.level,
        progress: controller.progress,
        progressTotal: controller.progressTotal,
        progressPercent: (controller.progress / controller.progressTotal) * 100,
        energyAvailable: room.energyAvailable,
        energyCapacityAvailable: room.energyCapacityAvailable
      })
      if (controller) {
        this.addStat('controller', {
          room: room.name
        }, {
          level: controller.level,
          progress: controller.progress,
          progressTotal: controller.progressTotal,
          progressPercent: (controller.progress / controller.progressTotal) * 100
        })
      }
      if (storage) {
        this.addStat('storage', {
          room: room.name
        }, storage.store)
      }
      if (terminal) {
        this.addStat('terminal', {
          room: room.name
        }, terminal.store)
      }
      const start = Game.cpu.getUsed()
      const events = room.getEventLog()
      const end = Game.cpu.getUsed()
      const eventStats = {
        stats: {
          count: events.length,
          parseTime: end - start
        },
        attack: {
          all: 0,
          melee: 0,
          ranged: 0,
          rangedMass: 0,
          dismantle: 0,
          hitBack: 0,
          nuke: 0
        },
        build: {
          amount: 0,
          energySpent: 0
        },
        harvest: {
          amount: 0
        },
        heal: {
          all: 0,
          melee: 0,
          ranged: 0
        },
        repair: {
          amount: 0,
          energySpent: 0
        },
        reserveController: {
          amount: 0
        },
        upgradeController: {
          amount: 0,
          energySpent: 0
        }
      }
      const etm = ['melee', 'ranged', 'rangedMass', 'dismantle', 'hitBack', 'nuke' ]
      for (const { event, objectId, data } of events) {
        switch (event) {
          case C.EVENT_ATTACK:
            eventStats.attack.all += data.amount
            eventStats.attack[etm[data.attackType - 1]] += data.amount
            break
          case C.EVENT_BUILD:
            eventStats.build.amount += data.amount
            eventStats.build.energySpent += data.energySpent
            break
          case C.EVENT_HARVEST:
            eventStats.harvest.amount += data.amount
            break
          case C.EVENT_HEAL:
            eventStats.heal.all += data.amount
            eventStats.heal[etm[data.healType - 1]] += data.amount
            break
          case C.EVENT_REPAIR:
            eventStats.repair.amount += data.amount
            eventStats.repair.energySpent += data.energySpent
            break
          case C.EVENT_RESERVE_CONTROLLER:
            eventStats.reserveController.amount += data.amount
            break
          case C.EVENT_UPGRADE_CONTROLLER:
            eventStats.upgradeController.amount += data.amount
            eventStats.upgradeController.energySpent += data.energySpent
            break
        }
      }      
      for (const [name, values] of Object.entries(eventStats)) {
        this.addStat(`events.${name}`, {
          room: room.name
        }, values)
      }
    })
    if (typeof Game.cpu.getHeapStatistics === 'function') {
      this.addStat('cpu.heapStatistics', {}, Game.cpu.getHeapStatistics())
    }
    const used = Game.cpu.getUsed()
    this.addStat('cpu', {}, {
      bucket: Game.cpu.bucket,
      used: used,
      getUsed: used,
      limit: Game.cpu.limit,
      start: this.cpuReset,
      percent: (used / Game.cpu.limit) * 100
    })
  }

  commit (opts) {
    if (!opts) {
      if (this.opts.baseStats) this.addBaseStats()
      if (this.opts.output) {
        for (const conf of this.opts.output) {
          this.commit(Object.assign({}, DRIVER_DEF, conf))
        }
        return
      }
      return this.commit(this.opts)
    }
    // console.log(opts.driver)
    const start = Game.cpu.getUsed()
    let stats = `text/${opts.driver.toLowerCase()}\n`
    stats += `${Game.time}\n`
    stats += `${Date.now()}\n`
    const format = this[`format${opts.driver}`].bind(this)
    _.each(this.stats, (v, k) => {
      stats += format(v)
    })
    const end = Game.cpu.getUsed()
    stats += format({ name: 'stats', tags: {}, values: { count: this.stats.length, size: stats.length, cpu: end - start } })
    if (opts.types.includes('segment')) {
      RawMemory.segments[opts.segment] = stats
    }
    if (opts.types.includes('memory')) {
      Memory[opts.key] = stats
    }
    if (opts.types.includes('console')) {
      console.log('STATS;' + stats.replace(/\n/g, ';'))
    }
  }

  formatInfluxDB (stat) {
    const { name, tags, values } = stat
    const ltags = Object.assign({}, tags, { user: this.user, shard: this.shard })
    return `${name},${this.kv(ltags)} ${this.kv(values)}\n`
  }
  
  formatPrometheus (stat) {
    const { name, tags, values } = stat
    const ltags = Object.assign({}, tags, { user: this.user, shard: this.shard })
    let out = ''
    const ts = Date.now()
    return _.map(values, (v, k) => [`${name}_${k}`.replace(/\./g, '_').replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}_${b}`).toLowerCase(), v])
      .filter(([,v]) => !isNaN(v))
      .map(([k,v]) => `${k}{${this.kvQuoted(ltags).join(',')}} ${v} ${ts}\n`)
      .join('')
  }

  formatGraphite (stat) {
    const { name, tags, values } = stat
    if (!this.prefix) {
      this.prefix = `${this.shard}` // .${this.shard}`
    }
    const pre = [this.prefix, this.kv(tags, '.').join('.'), name].filter(v => v).join('.')
    return this.kv(values, ' ').map(v => `${pre}.${v}\n`).join('')
  }

  kv (obj, sep = '=') {
    return _.map(obj, (v, k) => `${k}${sep}${v}`)
  }
  
  kvQuoted (obj, sep = '=') {
    return _.map(obj, (v, k) => `${k}${sep}"${v}"`)
  }
}

const driver = new InfluxDB(config)
export default driver
