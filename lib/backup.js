const i18n = require('i18n')
const UUID = require('uuid')
const path = require('path')
const Promise = require('bluebird')
const sanitize = require('sanitize-filename')
const { ipcMain } = require('electron')
const fs = Promise.promisifyAll(require('original-fs')) // eslint-disable-line

const { getMainWindow } = require('./window')
const { createTask } = require('./uploadTransform')

class BackUp {
  constructor (props) {
    this.props = props
    Object.assign(this, props)
    this.state = 'Idle'
  }

  readDir (dir, task) {
  }
}

const readUploadInfoAsync = async (entries, dirUUID, driveUUID, domain) => {
  /* remove unsupport files */
  let taskType = ''
  const filtered = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const name = path.parse(entry).base
    const stat = await fs.lstatAsync(path.resolve(entry))
    const entryType = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'others'
    /* only upload directory or file, ignore others, such as symbolic link */
    if (entryType !== 'others' && (name === sanitize(name))) {
      if (!taskType) taskType = entryType
      filtered.push({ entry, name, stat, entryType })
    }
  }

  /* createTask */
  if (filtered.length) {
    const policies = []
    const newEntries = filtered.map((f, i) => {
      const mode = 'overwrite'
      const checkedName = mode === 'rename' ? f.checkedName : undefined
      policies[i] = { mode, checkedName, remoteUUID: f.remoteUUID }
      return f.entry
    })
    const taskUUID = UUID.v4()
    const createTime = (new Date()).getTime()
    const newWork = true
    createTask(taskUUID, newEntries, dirUUID, driveUUID, taskType, createTime, newWork, policies, domain)
  }
  return filtered.length
}

const readUploadInfo = (entries, dirUUID, driveUUID, domain) => {
  readUploadInfoAsync(entries, dirUUID, driveUUID, domain)
    .then((count) => {
      let message = i18n.__n('%s Add to Transfer List', count)
      if (count < entries.length) message = `${message} (${i18n.__n('%s Ignore Upload Text', entries.length - count)})`
      getMainWindow().webContents.send('snackbarMessage', { message })
    })
    .catch((e) => {
      console.error('readUploadInfo error: ', e)
      if (e.code === 'ECONNREFUSED') {
        getMainWindow().webContents.send('snackbarMessage', { message: i18n.__('Connection Lost') })
      } else if (e.message !== 'cancel') {
        getMainWindow().webContents.send('snackbarMessage', { message: i18n.__('Read Upload Failed') })
      }
    })
}

const read = async (entries, task, parent) => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const stat = await fs.lstatAsync(path.resolve(entry))
    if (stat.mtimeMs > task.latestMtime) task.latestMtime = stat.mtimeMs
    if (!stat.isDirectory()) continue
    task.count += 1
    const children = await fs.readdirAsync(path.resolve(entry))
    const newEntries = []
    children.forEach(c => newEntries.push(path.join(entry, c)))
    const node = { entry, children: [], mtime: stat.mtimeMs, ctime: stat.ctimeMs }
    parent.children.push(node)
    // console.log(entry)

    await read(newEntries, task, node)
  }
  return ({ entries, task })
}

const backupHandle = (event, args) => {
  const { id, driveUUID, dirUUID, localPath } = args
  console.log('backupHandle', args)
  let lastLatestMtime = 0
  setInterval(() => {
    const t = { count: 0, size: 0, id, timeStamp: new Date().getTime(), children: [], latestMtime: 0 }
    read([localPath], t, t).then(({ entries, task }) => {
      event.sender.send('BACKUP_STAT', { entries, task })
      if (task.latestMtime > lastLatestMtime) {
        console.log(entries, task)
        lastLatestMtime = task.latestMtime
        readUploadInfo([localPath], driveUUID, dirUUID, 'backup')
      } else {
        console.log('no need to backup')
      }
    }).catch(e => console.error(e))
  }, 10 * 1 * 1000)
}

ipcMain.on('BACKUP', backupHandle)

module.exports = BackUp