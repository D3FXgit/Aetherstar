// CPU headroom sampling: only the main process can see what the native
// capture threads cost. `now`/`hrtime` are injectable for tests.

/** Percentage of one core consumed between (prevUsage, prevHrtimeNs) and now. */
function sampleCpuUsage(prevUsage, prevHrtimeNs, now = process.cpuUsage, hrtime = () => process.hrtime.bigint()) {
  const nowUsage = now()
  const nowHrtimeNs = hrtime()

  const cpuMicros = nowUsage.user - prevUsage.user + (nowUsage.system - prevUsage.system)
  const elapsedMicros = Number(nowHrtimeNs - prevHrtimeNs) / 1000
  const percent = elapsedMicros <= 0 ? 0 : (cpuMicros / elapsedMicros) * 100

  return { percent, sample: nowUsage, hrtimeNs: nowHrtimeNs }
}

/** Repeatedly samples at `intervalMs`, calling `onSample({ percent })` each tick. Returns a stop function. */
function startSampling(intervalMs, onSample) {
  let prevUsage = process.cpuUsage()
  let prevHrtimeNs = process.hrtime.bigint()

  const interval = setInterval(() => {
    const result = sampleCpuUsage(prevUsage, prevHrtimeNs)
    prevUsage = result.sample
    prevHrtimeNs = result.hrtimeNs
    onSample({ percent: result.percent })
  }, intervalMs)

  return () => clearInterval(interval)
}

module.exports = { sampleCpuUsage, startSampling }
