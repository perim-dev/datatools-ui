// @flow

import update from 'react-addons-update'
import objectPath from 'object-path'
import clone from 'lodash/cloneDeep'
import moment from 'moment'

import { sortAndFilterTrips } from '../util'
import { isTimeFormat } from '../util/timetable'
import {resequenceStops} from '../util/map'
import type {Action} from '../../types/actions'
import type {TimetableState} from '../../types/reducers'

export const defaultState = {
  status: {
    fetched: false,
    error: false,
    fetching: false
  },
  activeCell: null,
  trips: [],
  edited: [],
  selected: [],
  hideDepartureTimes: false,
  offset: 0,
  scrollIndexes: {
    scrollToColumn: 0,
    scrollToRow: 0
  }
}

/* eslint-disable complexity */
const timetable = (state: TimetableState = defaultState, action: Action): TimetableState => {
  switch (action.type) {
    case 'CLEAR_GTFSEDITOR_CONTENT':
      return defaultState
    case 'SETTING_ACTIVE_GTFS_ENTITY': {
      const {subSubEntityId} = action.payload
      if (subSubEntityId !== state.status.scheduleId) {
        // If the schedule ID has changed, reset the state to default.
        return {
          ...defaultState,
          status: {
            fetched: false,
            error: false,
            fetching: false,
            scheduleId: subSubEntityId
          }
        }
      } else {
        // Otherwise, do not impact the state.
        return state
      }
    }
    case 'REQUESTING_TRIPS_FOR_CALENDAR':
      return update(state, {
        status: {
          fetched: {$set: false},
          error: {$set: false},
          fetching: {$set: true}
        }
      })
    case 'SET_ACTIVE_TIMETABLE_CELL':
      return update(state, {
        activeCell: {$set: action.payload}
      })
    case 'SET_TIMETABLE_SCROLL_INDEXES':
      return update(state, {
        scrollIndexes: {$set: action.payload}
      })
    case 'RECEIVE_TRIPS_FOR_CALENDAR': {
      const {trips, pattern} = action.payload
      const clonedTrips = clone(sortAndFilterTrips(trips, pattern.use_frequency))
        .map(trip => {
          return {
            ...trip,
            // Ensure that stop sequences are zero-based if/when they are saved.
            stopTimes: trip.stopTimes.map(resequenceStops)
          }
        })
      return update(state, {
        trips: {$set: clonedTrips},
        status: {
          fetched: {$set: true},
          fetching: {$set: false}
        },
        edited: {$set: []}
      })
    }
    case 'RECEIVE_TRIPS_FROM_TEXT': {
      const currentTrips = state.trips;
      const {
        activePattern,
        route,
        service_id,
      } = action.payload.propsRoute;
      const { patternStops } = activePattern;
      
      const newTrips = action.payload.trips.map(trip => {
        let cumulativeTravelTime = 0;
        return {
          "route_id": route.route_id,
          "service_id": service_id,
          "trip_id": trip.trip_id,
          "trip_headsign": trip.trip_headsign,
          "trip_short_name": trip.trip_short_name,
          "direction_id": null,
          "block_id": null,
          "shape_id": null,
          "wheelchair_accessible": null,
          "bikes_allowed": null,
          "stopTimes": !patternStops[0] ? [] : patternStops.map(stop => {
            cumulativeTravelTime += stop.defaultTravelTime
            const arrivalTime = cumulativeTravelTime
            cumulativeTravelTime += stop.defaultDwellTime
            const departureTime = cumulativeTravelTime
            return {
              "tripId": null,
              "arrivalTime": arrivalTime,
              "departureTime": departureTime,
              "stopId": stop.stopId,
              "stopSequence": stop.stopSequence,
              "stopHeadsign": null,
              "pickupType": stop.pickupType,
              "dropOffType": stop.dropOffType,
              "shapeDistTraveled": stop.shapeDistTraveled,
              "timepoint": stop.timepoint,
              "continuousPickup": stop.continuousPickup,
              "continuousDropOff": stop.continuousDropOff
            }
          }),
          "blockId": null,
          "tripId": trip.trip_id,
          "tripHeadsign": trip.trip_headsign,
          "tripShortName": trip.trip_short_name,
          "frequencies": [
              {
                  "startTime": moment(trip.start_time, 'HH:mm:ss').diff(moment().startOf('day'), 'seconds'),
                  "endTime": moment(trip.end_time, 'HH:mm:ss').diff(moment().startOf('day'), 'seconds'),
                  "headwaySecs": trip.headway_sec,
                  "exactTimes": 0
              }
          ],
          "id": -2,
          "useFrequency": 1,
          "patternId": activePattern.patternId,
          "shapeId": activePattern.shapeId,
          "routeId": route.route_id,
          "directionId": null,
          "serviceId": service_id,
        }
      })

      const finalTrips = [...currentTrips, ...newTrips]
      
      return update(state, {
        trips: {$set: finalTrips},
        status: {
          fetched: {$set: true},
          fetching: {$set: false}
        },
        edited: {$push: newTrips.map((value, index) => index + (currentTrips.length))}
      })
    }
    case 'OFFSET_ROWS': {
      const trips = clone(state.trips)
      const editedRows = []
      // console.log(`Offsetting ${action.payload.rowIndexes.length} rows by ${action.payload.offset} seconds`)
      for (var i = 0; i < action.payload.rowIndexes.length; i++) {
        editedRows.push(action.payload.rowIndexes[i])
        for (var j = 0; j < action.payload.columns.length; j++) {
          const col = action.payload.columns[j]
          const path = `${action.payload.rowIndexes[i]}.${col.key}`
          if (isTimeFormat(col.type)) {
            const currentVal = objectPath.get(trips, path)
            // Arrival time can be > 24 hours for service day, so do not block offsetting by 24 hours.
            // Maintain empty cells (null) when offsetting.
            const value = currentVal !== null ? currentVal + action.payload.offset : null
            objectPath.set(trips, path, value)
          }
        }
      }
      return update(state, {
        trips: {$set: trips},
        edited: {$push: editedRows}
      })
    }
    case 'SET_TIMETABLE_OFFSET':
      return update(state, {
        offset: {$set: action.payload}
      })
    case 'UPDATE_TIMETABLE_CELL_VALUE': {
      const trips = clone(state.trips)
      objectPath.set(trips, action.payload.key, action.payload.value)
      return update(state, {
        trips: {$set: trips},
        edited: {$push: [action.payload.rowIndex]}
      })
    }
    case 'TOGGLE_ALL_TIMETABLE_ROW_SELECTION':
      const selected = []
      if (action.payload.active) {
        for (let i = 0; i < state.trips.length; i++) {
          selected.push(i)
        }
      }
      return update(state, {
        selected: {$set: selected}
      })
    case 'TOGGLE_DEPARTURE_TIMES':
      return update(state, {
        hideDepartureTimes: {$set: !state.hideDepartureTimes}
      })
    case 'ADD_NEW_TRIP':
      return update(state, {
        trips: {$push: [action.payload]},
        edited: {$push: [state.trips.length]}
      })
    case 'REMOVE_TRIPS':
      return update(state, {
        trips: {$splice: action.payload}
      })
    case 'TOGGLE_SINGLE_TIMETABLE_ROW_SELECTION':
      const selectIndex = state.selected.indexOf(action.payload.rowIndex)
      if (selectIndex === -1) {
        return update(state, {
          selected: {$push: [action.payload.rowIndex]}
        })
      } else {
        return update(state, {
          selected: {$splice: [[selectIndex, 1]]}
        })
      }
    default:
      return state
  }
}

export default timetable
