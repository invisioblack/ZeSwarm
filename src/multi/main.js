import config from './config'
import loader from './loader'
import MemHackHack from './MemHackHack'
import reset from './reset'
import { kernel } from '../kernel'
import { Logger } from '../log'
import '../InterShardRPC'
import '../PixelGen'
import './PowerCreepManager'
import './Settler'

const { name = 'fallback', gclLimit = 0, kernel: kernelConfig = {}, plugins = [] } = config

const code = loader(config)

const log = new Logger('[multi]')
log.info(`Bootloader started, codebase '${name}' loaded`)

kernel.createProcess('multiTest', function * () {
  while (true) {
    this.log.info('Multi Active')
    yield
  }
})

module.exports.loop = function () {
  MemHackHack.preTick()
  log.info(`CPU: ${Game.cpu.getUsed().toFixed(3)}/${Game.cpu.limit} BUCKET: ${Game.cpu.bucket}`)
  const sw = []
  sw.push(['loopStart', Game.cpu.getUsed()])
  if (gclLimit) {
    Game.gcl.level = gclLimit
  }
  if (kernelConfig.enabled) {
    kernel.tick()
  }
  sw.push(['mkernel', Game.cpu.getUsed()])
  code.loop()
  sw.push(['code', Game.cpu.getUsed()])
  if (Memory.stats) {
    RawMemory.segments[30] = JSON.stringify(Memory.stats)
  }
  let last = 0
  for (const [name, time] of sw) {
    const dur = time - last
    last = time
    log.info(`SW: ${name} ${dur}`)
  }
  log.info(`CPU: Used: ${Game.cpu.getUsed().toFixed(3)} Limit: ${Game.cpu.limit} Bucket: ${Game.cpu.bucket}`)
  log.info(`MEMORY: Used: ${(RawMemory.get().length / 1024).toFixed(3)}KB`)
  try {
    const { used_heap_size, heap_size_limit, total_available_size } = Game.cpu.getHeapStatistics()
    const MB = (v) => ((v / 1024) / 1024).toFixed(3)
    log.info(`HEAP: Used: ${MB(used_heap_size)}MB Available: ${MB(total_available_size)}MB Limit: ${MB(heap_size_limit)}MB`)
  } catch (e) {
    log.info('HEAP: stats unavailable')
  }
  MemHackHack.postTick()
}
