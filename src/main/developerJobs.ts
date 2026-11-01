import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'

let worker: UtilityProcess | undefined
let sequence = 0
const jobs = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
export function stopDeveloperJobs() {
  const old = worker; worker = undefined
  if (old) old.kill()
  for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(Error('Developer worker stopped.')) }
  jobs.clear()
}
export function runDeveloperJob(operation: 'probe' | 'replay', input: unknown): Promise<any> {
  if (jobs.size >= 4) return Promise.reject(Error('Four developer operations are already running.'))
  if (!worker) {
    worker = utilityProcess.fork(join(__dirname, 'developerWorker.js'), [], { serviceName: 'AIHub developer tools', stdio: 'ignore' })
    const current = worker
    current.on('message', ({ id, error, result }) => {
      const job = jobs.get(id); if (!job) return
      clearTimeout(job.timer); jobs.delete(id)
      if (error) job.reject(Error(error)); else job.resolve(result)
    })
    current.on('exit', () => { if (worker === current) stopDeveloperJobs() })
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(stopDeveloperJobs, 20_000)
    jobs.set(id, { resolve, reject, timer })
    try { worker!.postMessage({ id, operation, input }) }
    catch (error) { clearTimeout(timer); jobs.delete(id); reject(error) }
  })
}
