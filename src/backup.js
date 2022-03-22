const fs = require('fs');
const _ = require('lodash');
const exec = require('child_process').exec;
const zipFolder = require('zip-a-folder');
const config = require('./config');
const {
  authorize,
  uploadFile,
  deleteFile,
  listFile,
} = require('./google-drive');
const {
  sendErrorToTelegram,
  sendSuccessMessageToTelegram,
} = require('./system_notify');

// Backup script
async function backup() {
  console.info(`[${getVNDate()}] Backup database starting...`);

  try {
    await createFolderIfNotExists(config.autoBackupPath);
    let currentDate = getVNDate();

    let newBackupPath =
      config.autoBackupPath + '/' + formatYYYYMMDD(currentDate);

    // create backup file
    const cmd = getMongodumpCMD(newBackupPath);
    try {
      await runCommand(cmd);
    } catch (err) {
      console.log('Run command error');
      if (typeof err.message === 'string') {
        err.message = removeSensitive(err.message);
      }
      if (typeof err.cmd === 'string') {
        err.cmd = removeSensitive(err.cmd);
      }
      throw err;
    }

    // create zip file and remove old file
    const zipPath = await zipFolderPromise(newBackupPath);
    await runCommand(`rm -rf ${newBackupPath}`);

    // handle google drive
    const auth = await authorize();
    const fileName = zipPath.split('/').slice(-1)[0];

    try {
      const file = await uploadFile({
        auth,
        filePath: zipPath,
        fileName,
      });

      console.info(
        `[${getVNDate()}] Backup database to GG Drive with file name: ${file.name
        } successfully!`
      );
    } catch (error) {
      console.error('Push file to GG Drive error');
      throw error;
    }

    // if (config.telegramMessageLevels.includes('info')) {
    //   await sendSuccessMessageToTelegram(
    //     `Backup database to GG Drive with file name: ${file.name} successfully!`
    //   );
    // }
    if (config.telegramMessageLevels.includes('error')) {
      await sendSuccessMessageToTelegram(
        `Backup database to GG Drive with file name: ${file.name} successfully!`
      );
    }

    try {
      // check for remove old local backup after keeping # of days given in configuration
      if (config.isRemoveOldLocalBackup == 1) {
        let beforeDate = _.clone(currentDate);
        beforeDate.setDate(
          beforeDate.getDate() - config.keepLastDaysOfLocalBackup
        ); // Substract number of days to keep backup and remove old backup

        const oldBackupPath =
          config.autoBackupPath + '/' + formatYYYYMMDD(beforeDate); // old backup(after keeping # of days)
        if (fs.existsSync(`${oldBackupPath}.zip`)) {
          await runCommand(`rm -rf ${oldBackupPath}.zip`);
        }
      }

      // check for remove old drive backup after keeping # of days given in configuration
      if (config.isRemoveOldDriveBackup == 1) {
        let beforeDate = _.clone(currentDate);
        beforeDate.setDate(
          beforeDate.getDate() - config.keepLastDaysOfDriveBackup
        ); // Substract number of days to keep backup and remove old backup

        const oldBackupName = formatYYYYMMDD(beforeDate); // old backup(after keeping # of days)
        const files = await listFile(auth);
        for (const _file of files) {
          if (_file.name === `${oldBackupName}.zip`) {
            await deleteFile(auth, _file.id);
            // Do not break the loop because some files have the same name
          }
        }
      }
    } catch (err) {
      console.error('Delete file error: ', err);
      if (config.telegramMessageLevels.includes('error')) {
        await sendErrorToTelegram(`Delete backup file failed`, err);
      }
    }

    return;
  } catch (error) {
    console.error(error);
    if (config.telegramMessageLevels.includes('error')) {
      await sendErrorToTelegram(`Backup database to GG Drive failed`, error);
    }
  }
}

/**
 *
 * @param {string} output output folder
 */
function getMongodumpCMD(output) {
  let cmd = `mongodump`;
  if (config.uri) {
    cmd += ` --uri ${config.uri}`;
  }

  if (config.host) {
    cmd += ` --host ${config.host}`;
  }

  if (config.port) {
    cmd += ` --port ${config.port}`;
  }

  if (config.host.includes('rs')) {
    cmd += ` --readPreference secondaryPreferred`
  }

  if (config.user) cmd += ` --username ${config.user}`;
  if (config.pass) cmd += ` --password ${config.pass}`;
  cmd += ` --out ${output}`;

  return cmd;
}

/**
 *
 * @param {Date} date
 */
function formatYYYYMMDD(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function getVNDate() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })
  );
}

/**
 *
 * @param {string} _path
 * @returns {Promise<Boolean>}
 */
function createFolderIfNotExists(_path) {
  return new Promise((resolve, reject) =>
    fs.mkdir(_path, { recursive: true }, (err) => {
      // if (err) {
      //   return reject(err);
      // }

      resolve(true);
    })
  );
}

const empty = function (mixedVar) {
  let undef, key, i, len;
  let emptyValues = [undef, null, false, 0, '', '0'];
  for (i = 0, len = emptyValues.length; i < len; i++) {
    if (mixedVar === emptyValues[i]) {
      return true;
    }
  }
  if (typeof mixedVar === 'object') {
    for (key in mixedVar) {
      return false;
    }
    return true;
  }
  return false;
};

/**
 * Run shell script
 * @param {string} cmd
 * @returns {Promise<string>}
 */
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    return exec(cmd, (error, stdout, stderr) => {
      if (empty(error)) return resolve('Success');

      return reject(error);
    });
  });
}

/**
 * Zip file
 * @param {string} _path
 * @returns {Promise<string>}
 */
function zipFolderPromise(_path) {
  return new Promise((resolve, reject) => {
    const out = `${_path}.zip`;
    return zipFolder.zipFolder(_path, out, (error) => {
      if (error) return reject(error);

      resolve(out);
    });
  });
}

function removeSensitive(text) {
  if (config.user) {
    text = text.replace(config.user, '<hidden>');
  }

  if (config.pass) {
    text = text.replace(config.pass, '<hidden>');
  }

  return text;
}

module.exports = backup;
