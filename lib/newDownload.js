const fs = require('fs')
const i18n = require('i18n')
const path = require('path')
const UUID = require('uuid')
const { ipcMain, shell } = require('electron')

const store = require('./store')
const { getMainWindow } = require('./window')
const { downloadFile } = require('./server')
const { createTask } = require('./downloadTransform')

const getDownloadPath = () => store.getState().config.downloadPath

const downloadHandle = (event, args) => {
  const { entries, dirUUID, driveUUID, domain } = args
  const taskUUID = UUID.v4()
  const taskType = entries[0].type
  const createTime = (new Date()).getTime()
  const newWork = true

  const downloadPath = getDownloadPath()
  fs.readdir(downloadPath, (err, files) => {
    if (err) {
      console.error('downloadHandle fs.readdir error: ', err)
      getMainWindow().webContents.send('snackbarMessage', { message: i18n.__('Read Download Failed') })
    } else {
      // update entries' name to resolve name-confilict
      const targetNames = new Set(files)
      const nameSpace = new Set([...entries.map(e => e.name), ...files])

      entries.forEach((entry) => {
        const name = entry.name
        let newName = name
        if (targetNames.has(name) || targetNames.has(`${name}.download`)) {
          const extension = path.parse(name).ext
          for (let i = 1; nameSpace.has(newName) || nameSpace.has(`${newName}.download`); i++) {
            if (!extension || extension === name) {
              newName = `${name}(${i})`
            } else {
              newName = `${path.parse(name).name}(${i})${extension}`
            }
          }
        }
        entry.newName = newName
        targetNames.add(newName)
        nameSpace.add(newName)
      })
      createTask(taskUUID, entries, entries[0].newName, dirUUID, driveUUID, taskType, createTime, newWork, downloadPath, domain)
      getMainWindow().webContents.send('snackbarMessage', { message: i18n.__n('%s Add to Transfer List', entries.length) })
    }
  })
}

/* args: { driveUUID, dirUUID, entryUUID, fileName, station } */
const openHandle = (event, args) => {
  downloadFile(args, null, (error, filePath) => {
    if (error) {
      console.error('open file error', error)
      getMainWindow().webContents.send('snackbarMessage', { message: i18n.__('Open Via Local Failed') })
    } else shell.openItem(filePath)
  })
}

/* args: { driveUUID, dirUUID, entryUUID, fileName, session, station } */
const tempDownloadHandle = (e, args) => {
  const { session } = args
  downloadFile(args, null, (error, filePath) => {
    if (error) console.error('temp Download error', error)
    else getMainWindow().webContents.send('TEMP_DOWNLOAD_SUCCESS', session, filePath)
  })
}

const getTextDataHandle = (e, args) => {
  const { session } = args
  downloadFile(args, null, (error, filePath) => {
    if (error) console.error('getTextDataHandle error', error)
    else {
      fs.readFile(filePath, (err, data) => {
        if (err) console.error('getTextData readFile error', err)
        else getMainWindow().webContents.send('GET_TEXT_DATA_SUCCESS', session, { filePath, data: data.toString() })
      })
    }
  })
}

ipcMain.on('DOWNLOAD', downloadHandle)
ipcMain.on('TEMP_DOWNLOADING', tempDownloadHandle)
ipcMain.on('OPEN_FILE', openHandle) // open file use system applications
ipcMain.on('GET_TEXT_DATA', getTextDataHandle)
