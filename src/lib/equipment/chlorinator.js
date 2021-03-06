/*  nodejs-poolController.  An application to control pool equipment.
 *  Copyright (C) 2016, 2017.  Russell Goldin, tagyoureit.  russ.goldin@gmail.com
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var currentChlorinatorStatus

module.exports = function(container) {

  /*istanbul ignore next */
  if (container.logModuleLoading)
    container.logger.info('Loading: chlorinator.js')

  function Chlorinator(saltPPM, currentOutput, outputPoolPercent, outputSpaPercent, superChlorinate, version, name, status) {

    this.saltPPM = saltPPM;
    this.currentOutput = currentOutput //actual output as reported by the chlorinator
    this.outputPoolPercent = outputPoolPercent; //for intellitouch this is the pool setpoint, for standalone it is the default
    this.outputSpaPercent = outputSpaPercent; //intellitouch has both pool and spa set points
    this.superChlorinate = superChlorinate;
    this.version = version;
    this.name = name;
    this.status = status;
  }

  //module.exports = Chlorinator

  var init = function() {
    currentChlorinatorStatus = new Chlorinator(-1, -1, -1, -1, -1, -1, -1);
    return container.configEditor.getChlorinatorDesiredOutput()
      .then(function(output) {
        currentChlorinatorStatus.outputPoolPercent = output
      })
      .then(container.configEditor.getChlorinatorName)
      .then(function(name) {
        currentChlorinatorStatus.name = name
      })
      .catch(function(err) {
        container.logger.error('Something went wrong loading chlorinator data from the config file.', err)
      })
  }

  var chlorinatorStatusStr = function(status) {
    // 0: "Ok",
    // 1: "No flow",
    // 2: "Low Salt",
    // 4: "High Salt",
    // 132: "Comm Link Error(?).  Low Salt",
    // 144: "Clean Salt Cell",
    // 145: "???"
    //MSb to LSb [ "Check Flow/PCB","Low Salt","Very Low Salt","High Current","Clean Cell","Low Voltage","Water Temp Low","No Comm","OK" ]

    var chlorStr = ''
    var needDelim = 0;
    if ((status === 0)) {
      chlorStr += 'Ok';
      needDelim = 1
    }

    if ((status & 1) === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'Low Flow'; //1
    }
    if ((status & 2) >> 1 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'Low Salt'; // 2
    }
    if ((status & 4) >> 2 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'Very Low Salt'; // 4
    }
    if ((status & 8) >> 3 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'High Current'; //8
    }
    if ((status & 16) >> 4 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'Clean Cell'; //16
    }
    if ((status & 32) >> 5 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'Low Voltage'; //32
    }
    if ((status & 64) >> 6 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'Water Temp Low'; //64
    }
    if ((status & 128) >> 7 === 1) {
      needDelim ? chlorStr += ', ' : needDelim = 1
      chlorStr += 'No communications'
    }
    return chlorStr
    //
    // 0: "Ok",
    // 1: "No communications",
    // 2: "Water Temp Low",
    // 4: "Low Voltage",
    // 8: "Clean Cell",
    // 16: "High Current",
    // 32: "Very Low Salt",
    // 64: "Low Salt",
    // 128: "Check Flow/PCB"
  }


  function setChlorinatorStatusFromController(saltPPM, outputPoolPercent, outputSpaPercent, status, name, counter) {
    var chlorinatorStatus = {}
    chlorinatorStatus.saltPPM = saltPPM * 50
    chlorinatorStatus.currentOutput = currentChlorinatorStatus.hasOwnProperty('currentOutput') ? currentChlorinatorStatus.currentOutput : -1; //if chlorinator has reported a current output percent, keep it.  Otherwise set to -1
    chlorinatorStatus.outputPoolPercent = outputPoolPercent
    chlorinatorStatus.outputSpaPercent = (outputSpaPercent - 1) / 2; //41 would equal 20%, for example
    chlorinatorStatus.superChlorinate = outputPoolPercent >= 100 ? 1 : 0;
    //TODO: take care of unknown status' here.  Is this right?
    chlorinatorStatus.status = chlorinatorStatusStr(status)
    chlorinatorStatus.name = name;

    if (currentChlorinatorStatus.saltPPM === -1) {
      currentChlorinatorStatus = JSON.parse(JSON.stringify(chlorinatorStatus));
      if (container.settings.logChlorinator)
        container.logger.info('Msg# %s   Initial chlorinator settings discovered: ', counter, JSON.stringify(currentChlorinatorStatus))
      container.configEditor.updateChlorinatorName(name)
      container.configEditor.updateChlorinatorDesiredOutput(outputPoolPercent)
      container.io.emitToClients('chlorinator');
    } else
    if (JSON.stringify(currentChlorinatorStatus) === JSON.stringify(chlorinatorStatus)) {
      if (container.settings.logChlorinator)
        container.logger.debug('Msg# %s   Chlorinator status has not changed. ', counter)
    } else {
      if (container.settings.logChlorinator) {
        container.logger.verbose('Msg# %s   Chlorinator status changed \nfrom: %s \nto: %s ', counter,
          // currentChlorinatorStatus.whatsDifferent(chlorinatorStatus));
          JSON.stringify(currentChlorinatorStatus), JSON.stringify(chlorinatorStatus))
      }
      container.configEditor.updateChlorinatorName(name)
      container.configEditor.updateChlorinatorDesiredOutput(outputPoolPercent)
      currentChlorinatorStatus = JSON.parse(JSON.stringify(chlorinatorStatus));
      container.io.emitToClients('chlorinator');
    }
    container.influx.writeChlorinator(currentChlorinatorStatus)
    return currentChlorinatorStatus

  }

  function getChlorinatorNameByBytes(nameArr) {
    var name = ''
    for (var i = 0; i < nameArr.length; i++) {
      name += String.fromCharCode(nameArr[i]);
      //console.log('i: %s ,namearr[i]: %s, char: %s  name: %s', i, nameArr[i],  String.fromCharCode(nameArr[i]) ,name )
    }
    return name
  }

  function getChlorinatorName() {
    return currentChlorinatorStatus.name
  }

  function getSaltPPM() {
    return this.saltPPM
  }

  function getChlorinatorStatus() {
    return currentChlorinatorStatus
  }

  function setChlorinatorLevel(chlorLvl, callback) {
    var response = {}
    if (container.settings.chlorinator.installed) {
      if (chlorLvl >= 0 && chlorLvl <= 101) {
        currentChlorinatorStatus.outputPoolPercent = chlorLvl
        if (currentChlorinatorStatus.outputPoolPercent === 0) {
          response.text = 'Chlorinator set to off.  Chlorinator will be queried every 30 mins for PPM'
          response.status = 'off'
          response.value = 0
        } else if (currentChlorinatorStatus.outputPoolPercent >= 1 && currentChlorinatorStatus.outputPoolPercent <= 100) {
          response.text = 'Chlorinator set to ' + currentChlorinatorStatus.outputPoolPercent + '%.'
          response.status = 'on'
          response.value = currentChlorinatorStatus.outputPoolPercent
        } else if (currentChlorinatorStatus.outputPoolPercent === 101) {
          response.text = 'Chlorinator set to super chlorinate'
          response.status = 'on'
          response.value = currentChlorinatorStatus.outputPoolPercent
        }
        container.configEditor.updateChlorinatorDesiredOutput(chlorLvl)
        container.io.emitToClients('chlorinator')
        container.chlorinatorController.chlorinatorStatusCheck()
        if (container.settings.logChlorinator) {
          container.logger.info(response)
        }

      } else {

        response.text = 'FAIL: Request for invalid value for chlorinator (' + chlorLvl + ').  Chlorinator will continue to run at previous level (' + currentChlorinatorStatus.outputPoolPercent + ')'
        response.status = this.status
        response.value = currentChlorinatorStatus.outputPoolPercent
        if (container.settings.logChlorinator) {
          container.logger.warn(response)
        }
      }
    } else {
      response.text = 'FAIL: Chlorinator not enabled.  Set Chlorinator=1 in config.json'
    }
    if (callback !== undefined) {
      callback(response)
    }
    return response
  }

  function getDesiredChlorinatorOutput() {
    return currentChlorinatorStatus.outputPoolPercent
  }

  function setChlorinatorStatusFromChlorinator(data, counter) {

    var destination, from, currentOutput;
    if (data[container.constants.chlorinatorPacketFields.DEST] === 80) {
      destination = 'Salt cell';
      from = 'Controller'
    } else {
      destination = 'Controller'
      from = 'Salt cell'
    }

    switch (data[container.constants.chlorinatorPacketFields.ACTION]) {
      case 0: //Get status of Chlorinator
        {
          if (container.settings.logChlorinator)
            container.logger.verbose('Msg# %s   %s --> %s: Please provide status: %s', counter, from, destination, data)

          break;
        }
      case 1: //Response to get status
        {
          if (container.settings.logChlorinator)
            container.logger.verbose('Msg# %s   %s --> %s: I am here: %s', counter, from, destination, data)

          break;
        }
      case 3: //Response to version
        {
          var name = '';
          var version = data[4];
          for (var i = 5; i <= 20; i++) {
            name += String.fromCharCode(data[i]);
          }

          if (currentChlorinatorStatus.name !== name && currentChlorinatorStatus.version !== version) {
            if (container.settings.logChlorinator)
              container.logger.verbose('Msg# %s   %s --> %s: Chlorinator version (%s) and name (%s): %s', counter, from, destination, version, name, data);
            currentChlorinatorStatus.name = name
            currentChlorinatorStatus.version = version
            container.configEditor.updateChlorinatorName(name)
            container.io.emitToClients('chlorinator')
          }

          break;
        }
      case 17: //Set Generate %
        {
          currentOutput = data[4];
          var superChlorinate
          if (data[4] >= 100) {
            superChlorinate = 1
          } else {
            superChlorinate = 0
          }
          if (currentChlorinatorStatus.currentOutput !== currentOutput || currentChlorinatorStatus.superChlorinate !== superChlorinate) {
            if (container.settings.logChlorinator)
              container.logger.verbose('Msg# %s   %s --> %s: Set current output to %s %: %s', counter, from, destination, superChlorinate === 'On' ? 'Super Chlorinate' : currentOutput, data);
            currentChlorinatorStatus.currentOutput = currentOutput
            currentChlorinatorStatus.superChlorinate = superChlorinate
            container.io.emitToClients('chlorinator')
          }

          break
        }
      case 18: //Response to 17 (set generate %)
        {

          var saltPPM = data[4] * 50;
          var status = chlorinatorStatusStr(data[5])
          // switch (data[5]) {
          //     case 0: //ok
          //         {
          //             status = "Ok";
          //             break;
          //         }
          //     case 1:
          //         {
          //             status = "No flow";
          //             break;
          //         }
          //     case 2:
          //         {
          //             status = "Low Salt";
          //             break;
          //         }
          //     case 4:
          //         {
          //             status = "High Salt";
          //             break;
          //         }
          //     case 144:
          //         {
          //             status = "Clean Salt Cell"
          //             break;
          //         }
          //     default:
          //         {
          //             status = "Unknown - Status code: " + data[5];
          //         }
          // }
          if (currentChlorinatorStatus.saltPPM !== saltPPM || currentChlorinatorStatus.status !== status) {
            if (container.settings.logChlorinator)
              container.logger.verbose('Msg# %s   %s --> %s: Current Salt level is %s PPM: %s', counter, from, destination, saltPPM, data);
            currentChlorinatorStatus.saltPPM = saltPPM
            currentChlorinatorStatus.status = status
            container.io.emitToClients('chlorinator')

          }

          break
        }
      case 20: //Get version
        {
          if (container.settings.logChlorinator)
            container.logger.verbose('Msg# %s   %s --> %s: What is your version?: %s', counter, from, destination, data)
          break
        }
      case 21: //Set Generate %, but value / 10??
        {
          currentOutput = data[6] / 10;

          if (currentChlorinatorStatus.currentOutput !== currentOutput) {
            if (container.settings.logChlorinator)
              container.logger.verbose('Msg# %s   %s --> %s: Set current output to %s %: %s', counter, from, destination, currentOutput, data);
            currentChlorinatorStatus.currentOutput = currentOutput
            container.io.emitToClients('chlorinator')
          }
          break
        }
      default:
        {
          if (container.settings.logChlorinator)
            container.logger.verbose('Msg# %s   %s --> %s: Other chlorinator packet?: %s', counter, from, destination, data)
        }
    }

    if (currentChlorinatorStatus.name === -1 && container.chlorinatorController.isChlorinatorTimerRunning() === 1)
    // If we see a chlorinator status packet, then request the name, but only if the chlorinator virtual
    // controller is enabled.  Note that if the Intellichlor is used, it doesn't respond to the following;
    // it's name will be in the Intellitouch status packet.
    {
      container.logger.verbose('Queueing messages to retrieve Salt Cell Name (AquaRite or OEM)')
      //get salt cell name
      if (container.settings.logPacketWrites) {
        container.logger.debug('decode: Queueing packet to retrieve Chlorinator Salt Cell Name: [16, 2, 80, 20, 0]')
      }
      container.queuePacket.queuePacket([16, 2, 80, 20, 0]);
    }


  }


  /*istanbul ignore next */
  if (container.logModuleLoading)
    container.logger.info('Loaded: chlorinator.js')


  return {
    init: init,
    setChlorinatorStatusFromChlorinator: setChlorinatorStatusFromChlorinator,
    getDesiredChlorinatorOutput: getDesiredChlorinatorOutput,
    setChlorinatorStatusFromController: setChlorinatorStatusFromController,
    getChlorinatorName: getChlorinatorName,
    getChlorinatorNameByBytes: getChlorinatorNameByBytes,
    getSaltPPM: getSaltPPM,
    getChlorinatorStatus: getChlorinatorStatus,
    setChlorinatorLevel: setChlorinatorLevel

  }
}
