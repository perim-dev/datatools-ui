// @flow

import clone from 'lodash/cloneDeep'
import objectPath from 'object-path'
import React, {Component} from 'react'
import {Button} from 'react-bootstrap'
import moment from 'moment'

import {camelCaseKeys} from '../../../common/util/map-keys'
import * as activeActions from '../../actions/active'
import * as tripActions from '../../actions/trip'
import {ENTITY} from '../../constants'
import {generateNullProps} from '../../util/gtfs'
import {entityIsNew} from '../../util/objects'
import {isTimeFormat} from '../../util/timetable'
import type {Props as ContainerProps} from '../../containers/ActiveTimetableEditor'
import type {Feed, FetchStatus, Pattern, StopTime, TimetableColumn, Trip, TripCounts} from '../../../types'
import type {TripValidationIssues} from '../../selectors/timetable'
import type {EditorTables, TimetableState} from '../../../types/reducers'

import TimetableHelpModal from './TimetableHelpModal'
import TimetableBulkInsertModal from './TimetableBulkInsertModal'
import TimetableHeader from './TimetableHeader'
import Timetable from './Timetable'

type Props = ContainerProps & {
  activeCell?: ?string,
  activePattern: Pattern,
  activePatternId: number,
  activeSchedule: string,
  activeScheduleId: string,
  addNewTrip: typeof tripActions.addNewTrip,
  updateTripFromText: typeof tripActions.updateTripFromText,
  columns: Array<TimetableColumn>,
  data?: Array<Trip>,
  deleteTripsForCalendar: typeof tripActions.deleteTripsForCalendar,
  feedSource: Feed,
  fetchCalendarTripCountsForPattern: typeof tripActions.fetchCalendarTripCountsForPattern,
  fetchTripsForCalendar: typeof tripActions.fetchTripsForCalendar,
  offsetRows: typeof tripActions.offsetRows,
  removeTrips: typeof tripActions.removeTrips,
  saveTripsForCalendar: typeof tripActions.saveTripsForCalendar,
  setActiveCell: typeof tripActions.setActiveCell,
  setActiveEntity: typeof activeActions.setActiveEntity,
  setOffset: typeof tripActions.setOffset,
  setScrollIndexes: typeof tripActions.setScrollIndexes,
  tableData: EditorTables,
  timetable: TimetableState,
  timetableStatus: FetchStatus,
  toggleAllRows: typeof tripActions.toggleAllRows,
  toggleDepartureTimes: typeof tripActions.toggleDepartureTimes,
  toggleRowSelection: typeof tripActions.toggleRowSelection,
  tripCounts: TripCounts,
  tripValidationErrors: TripValidationIssues,
  updateCellValue: typeof tripActions.updateCellValue
}

type State = {
  height: number,
  showHelpModal: boolean,
  showBulkModal: boolean,
  width: number
}

export default class TimetableEditor extends Component<Props, State> {
  // State is used to track height/width of the window to dynamically adjust
  // height of Grid as well as the visibility of the help modal.
  state = {
    height: 680,
    showHelpModal: false,
    showBulkModal: false,
    width: 1280
  }

  _onResize = () => this.setState({width: window.innerWidth, height: window.innerHeight})

  _createNewCalendar = () => this.props.setActiveEntity(
    this.props.feedSource.id,
    'calendar',
    {id: ENTITY.NEW_ID}
  )

  _hideHelpModal = () => this.setState({showHelpModal: false})

  _showHelpModal = () => this.setState({showHelpModal: true})
  
  _hideBulkModal = () => this.setState({showBulkModal: false})

  _showBulkModal = () => this.setState({showBulkModal: true})

  /**
   * Handle re-fetching trips if the schedule ID changes (or on initial mount).
   */
  componentWillReceiveProps (nextProps: Props) {
    const {activeScheduleId: previousScheduleId} = this.props
    const {
      feedSource,
      fetchTripsForCalendar,
      activePattern,
      activeSchedule,
      activeScheduleId,
      timetableStatus
    } = nextProps
    const scheduleIdChanged = previousScheduleId !== activeScheduleId
    if (feedSource && activePattern && activeSchedule) {
      // Only fetch trips if the feed, pattern, and schedule are present.
      if (scheduleIdChanged) {
        // Re-fetch on schedule ID change.
        fetchTripsForCalendar(feedSource.id, activePattern, activeScheduleId)
      } else if (!timetableStatus.fetched && !timetableStatus.fetching) {
        // Handle initial fetch
        fetchTripsForCalendar(feedSource.id, activePattern, activeScheduleId)
      }
    }
  }

  componentWillMount () {
    this._onResize()
  }

  componentDidMount () {
    window.addEventListener('resize', this._onResize)
  }

  componentWillUnmount () {
    window.removeEventListener('resize', this._onResize)
  }

  /**
   * Returns an array of the currently selected indexes OR a singleton array
   * containing the row index where the cursor is presently active.
   */
  _getSelectedRowIndexes = () => {
    const {selected, scrollIndexes} = this.props.timetable
    return selected.length > 0
      ? selected
      : [scrollIndexes.scrollToRow]
  }

  _offsetWithDefaults = (negative: boolean = false) => {
    const {columns, offsetRows, timetable} = this.props
    const rowIndexes = this._getSelectedRowIndexes()
    const {offset: currentOffset} = timetable
    const offset = negative ? currentOffset * -1 : currentOffset
    if (offset === 0 || isNaN(offset)) {
      console.warn(`invalid offset value=${offset}`)
      return
    }
    offsetRows({columns, rowIndexes, offset})
  }

  cloneSelectedTrips = () => this.duplicateRows(this._getSelectedRowIndexes())

  constructNewRow = (toClone: ?Trip = null) => {
    const {activePatternId, route} = this.props
    const activePattern = route && route.tripPatterns
      ? route.tripPatterns.find(p => p.id === activePatternId)
      : null
    if (!activePattern) {
      console.warn('Pattern ID not found in route', route, activePatternId)
      return
    }
    // If cloning a row, use toClone object as a baseline object.
    const blankTrip: Trip = generateNullProps('trip')
    const newRow: Trip = toClone
      ? clone(toClone) || blankTrip
      : blankTrip
    if (toClone) {
      // Update trip's internal ID and trip ID if cloning.
      objectPath.set(newRow, 'id', ENTITY.NEW_ID)
      objectPath.set(newRow, 'tripId', null)
      return newRow
    } else {
      // set starting time for first arrival
      let cumulativeTravelTime = !toClone
        ? 0
        : objectPath.get(newRow, `stopTimes.0.arrivalTime`)

      // TODO: auto-add offset to any new trip?  No, for now. Perhaps we could
      // add toggle/checkbox that allows for this.
      // cumulativeTravelTime += this.props.timetable.offset

      for (let i = 0; i < activePattern.patternStops.length; i++) {
        const stop = activePattern.patternStops[i]
        // if stopTime null/undefined, set as new object
        if (!objectPath.get(newRow, `stopTimes.${i}`)) {
          // FIXME: Change all stop time props to be snake case. They are camel
          // case because that's how the previous GTFS Editor model object fields
          // were named. And unlike the other standard tables, trips and stop times
          // were handled in the client as camelcase.
          const blankStopTime: StopTime = camelCaseKeys(generateNullProps('stoptime'))
          objectPath.set(newRow, `stopTimes.${i}`, blankStopTime)
        }
        objectPath.set(newRow, `stopTimes.${i}.stopId`, stop.stopId)
        cumulativeTravelTime += +stop.defaultTravelTime

        // only set time if timepoint set to true or null
        // if (stop.timepoint === null || stop.timepoint) {
        objectPath.set(newRow, `stopTimes.${i}.arrivalTime`, cumulativeTravelTime)
        // }
        cumulativeTravelTime += +stop.defaultDwellTime
        // if (stop.timepoint === null || stop.timepoint) {
        objectPath.set(newRow, `stopTimes.${i}.departureTime`, cumulativeTravelTime)
        objectPath.set(newRow, `stopTimes.${i}.continuousPickup`, stop.continuousPickup)
        objectPath.set(newRow, `stopTimes.${i}.continuousDropOff`, stop.continuousDropOff)
        objectPath.set(newRow, `stopTimes.${i}.timepoint`, stop.timepoint || 0)
        objectPath.set(newRow, `stopTimes.${i}.shapeDistTraveled`, stop.shapeDistTraveled)
        // Use pattern stop index to set stop sequence. Stop sequences should all
        // be zero-based and incrementing in the editor, but in the case that
        // they're not (e.g., due to a bad import) simply default to the index.
        objectPath.set(newRow, `stopTimes.${i}.stopSequence`, i)
        // }
      }
      for (let i = 0; i < this.props.columns.length; i++) {
        const col = this.props.columns[i]
        if (isTimeFormat(col.type)) {
          // TODO: add default travel/dwell times to new rows
          // objectPath.ensureExists(newRow, col.key, 0)
        } else {
          objectPath.ensureExists(newRow, col.key, null)
        }
      }
      // IMPORTANT: set id to NEW_ID
      objectPath.set(newRow, 'id', ENTITY.NEW_ID)
      objectPath.set(newRow, 'tripId', null)
      objectPath.set(newRow, 'useFrequency', activePattern.useFrequency)
      if (activePattern.useFrequency) {
        // If a frequency-based trip, never use exact times. NOTE: there is no
        // column to edit this field in the timetable grid.
        objectPath.set(newRow, 'frequencies.0.exactTimes', 0)
      } else {
        // If not using frequencies, set frequencies to empty array so that SQL backend
        // is happy.
        objectPath.set(newRow, 'frequencies', [])
      }
      // Set fields derived from pattern.
      if (activePattern) {
        objectPath.set(newRow, 'patternId', activePattern.patternId)
        objectPath.set(newRow, 'shapeId', activePattern.shapeId)
        objectPath.set(newRow, 'routeId', activePattern.routeId)
        objectPath.set(newRow, 'directionId', activePattern.directionId)
        // Set service ID
        objectPath.set(newRow, 'serviceId', this.props.activeScheduleId)
      }

      return newRow
    }
  }

  duplicateRows = (indexArray: Array<number>) => {
    // const {activePattern, activeScheduleId} = this.props
    const arrayAscending = indexArray.sort((a, b) => {
      return a - b
    })
    const lastIndex = this.props.timetable.trips.length - 1
    for (var i = 0; i < arrayAscending.length; i++) {
      const index = arrayAscending[i]
      const toClone = this.props.timetable.trips[index]
      const newRow = this.constructNewRow(toClone)
      // TODO: replace addNewTrip with func that saves trip via POST
      // this.props.addNewTrip(activePattern.feedId, activePattern, activeScheduleId, newRow)
      this.props.addNewTrip(newRow)
      // Move cursor to last row.
      this.props.setScrollIndexes({
        scrollToRow: lastIndex + arrayAscending.length,
        scrollToColumn: 0
      })
    }
  }

  addNewRow = (blank: ?boolean = false, scroll: ?boolean = false) => {
    const {addNewTrip, setScrollIndexes, timetable} = this.props
    // set blank to true if there are no rows to clone
    blank = blank || timetable.trips.length === 0
    const lastIndex = timetable.trips.length - 1
    const clone = blank ? null : timetable.trips[lastIndex]
    const newRow = this.constructNewRow(clone)
    // TODO: replace addNewTrip with func that saves trip via POST?
    addNewTrip(newRow)
    if (scroll) {
      // Increment selected row
      setScrollIndexes({
        scrollToRow: lastIndex + 1,
        scrollToColumn: 0
      })
    }
  }
  
  addBulkNewRow = (blank: ?boolean = false, scroll: ?boolean = false, csvTrip: string) => {
    const {addNewTrip, setScrollIndexes, timetable} = this.props
    // set blank to true if there are no rows to clone
    blank = blank || timetable.trips.length === 0
    const lastIndex = timetable.trips.length - 1
    const clone = blank ? null : timetable.trips[lastIndex]
    
    // TODO: replace addNewTrip with func that saves trip via POST?

    const arrayTrip = csvTrip.split('\n').map(i => {
      const trimedString = i.trim();
      return trimedString.split(',');
    })
    const [attrFromHeader] = arrayTrip.slice(0,1)
    const dataTrip = arrayTrip.slice(1)
    const ObjParsedTrip = dataTrip.map(trip => {
      // trip_id,trip_headsign,trip_short_name,start_time,end_time,headway_secs
      // 1,aaa,a001,06:00:00,08:00:00,500
      // 2,bbb,a002,08:00:00,10:00:00,600
      // 3,ccc,a003,10:00:00,12:00:00,700
      // trip_id,trip_headsign,trip_short_name,start_time,end_time,headway_secs


      return {
        trip_id: trip[0],
        trip_headsign: trip[1],
        trip_short_name: trip[2],
        start_time: trip[3],
        end_time: trip[4],
        headway_sec: trip[5]*1,
      }
    })

    ObjParsedTrip.map(trip => {
      const newRow = this.constructNewRow(clone)
      objectPath.set(newRow, 'tripId', trip.trip_id)
      objectPath.set(newRow, 'tripHeadsign', trip.trip_headsign)
      objectPath.set(newRow, 'tripShortName', trip.trip_short_name)
      objectPath.set(newRow, 'frequencies.0.startTime', moment(trip.start_time, 'HH:mm:ss').diff(moment().startOf('day'), 'seconds'))
      objectPath.set(newRow, 'frequencies.0.endTime', moment(trip.end_time, 'HH:mm:ss').diff(moment().startOf('day'), 'seconds'))
      objectPath.set(newRow, 'frequencies.0.headwaySecs', trip.headway_sec)

      addNewTrip(newRow)
    })

    if (scroll) {
      // Increment selected row
      setScrollIndexes({
        scrollToRow: lastIndex + 1,
        scrollToColumn: 0
      })
    }
  }

  removeSelectedRows = () => {
    const {
      timetable,
      deleteTripsForCalendar,
      feedSource,
      activePattern,
      activeScheduleId,
      removeTrips,
      showConfirmModal,
      toggleAllRows
    } = this.props
    const selectedCount = timetable.selected.length
    if (selectedCount < 1) {
      // There are no selected trips to delete. User not permitted to delete trip
      // where the cursor is active unless it is explicitly selected.
      return
    }
    showConfirmModal({
      title: `Delete trips?`,
      body: `Are you sure you want to permanently delete ${selectedCount} selected trip${selectedCount > 1 ? 's' : ''}?`,
      confirmButtonStyle: 'danger',
      confirmButtonText: 'Delete trips',
      onConfirm: () => {
        const indexes = []
        const tripsToDelete = []
        const newRows = [...timetable.trips]
        const selectedDescending = timetable.selected.sort((a, b) => {
          return b - a
        })
        // Iterate over selected rows in descending order to ensure that indexes
        // operate on indexes in reverse.
        for (var i = 0; i < selectedDescending.length; i++) {
          const rowIndex = selectedDescending[i]
          const row = newRows[rowIndex]
          if (entityIsNew(row)) {
            indexes.push([rowIndex, 1])
          } else {
            tripsToDelete.push(row)
          }
        }
        if (tripsToDelete.length > 0) {
          deleteTripsForCalendar(
            feedSource.id,
            activePattern,
            activeScheduleId,
            tripsToDelete
          )
        }
        removeTrips(indexes)
        toggleAllRows({active: false})
      }
    })
  }

  saveEditedTrips = (pattern: Pattern, activeScheduleId: string) => {
    const {feedSource, saveTripsForCalendar, timetable} = this.props
    const trips = []
    const tripIndexes = []
    for (var i = 0; i < timetable.edited.length; i++) {
      const rowIndex = timetable.edited[i]
      if (tripIndexes.indexOf(rowIndex) === -1) {
        const trip = timetable.trips[rowIndex]
        if (trip) {
          trips.push(trip)
          tripIndexes.push(rowIndex)
        }
      }
    }
    saveTripsForCalendar(feedSource.id, pattern, activeScheduleId, trips)
  }

  isDataValid (col: TimetableColumn, value: number, previousValue: number) {
    if (isTimeFormat(col.type)) {
      return value && value >= 0 && value < previousValue
    } else {
      return true
    }
  }

  render () {
    const {
      activePattern,
      activeSchedule,
      timetable,
      toggleAllRows,
      toggleRowSelection,
      tripCounts,
    } = this.props
    const {scrollToRow, scrollToColumn} = timetable.scrollIndexes
    const {height} = this.state

    const panelStyle = {
      backgroundColor: 'white',
      paddingRight: '5px',
      paddingLeft: '5px'
    }
    const HEADER_HEIGHT = 118

    console.log('PROPS', this.props);
    return (
      <div
        style={panelStyle}
        className='timetable-editor'>
        <TimetableHelpModal
          onClose={this._hideHelpModal}
          show={this.state.showHelpModal} />
        <TimetableBulkInsertModal
          updateTripFromText={this.props.updateTripFromText}
          onClose={this._hideBulkModal}
          activePattern={this.props.activePattern}
          route={this.props.route}
          addBulkNewRow={this.addBulkNewRow}
          service_id={this.props.activeSchedule ? this.props.activeSchedule.service_id : undefined}
          show={this.state.showBulkModal} 
          {...this.props}/>
        <TimetableHeader
          activePattern={activePattern}
          hideHelpModal={this._hideHelpModal}
          showHelpModal={this._showHelpModal}
          hideBulkModal={this._hideBulkModal}
          showBulkModal={this._showBulkModal}
          tripCounts={tripCounts}
          removeSelectedRows={this.removeSelectedRows}
          addNewRow={this.addNewRow}
          offsetWithDefaults={this._offsetWithDefaults}
          cloneSelectedTrips={this.cloneSelectedTrips}
          saveEditedTrips={this.saveEditedTrips}
          {...this.props} />
        {activeSchedule
          ? <Timetable
            style={{height: `${height - HEADER_HEIGHT - 50}px`}}
            addNewRow={this.addNewRow}
            cloneSelectedTrips={this.cloneSelectedTrips}
            showHelpModal={this._showHelpModal}
            showBulkModal={this._showBulkModal}
            offsetWithDefaults={this._offsetWithDefaults}
            removeSelectedRows={this.removeSelectedRows}
            toggleRowSelection={toggleRowSelection}
            toggleAllRows={toggleAllRows}
            saveEditedTrips={this.saveEditedTrips}
            scrollToRow={scrollToRow}
            scrollToColumn={scrollToColumn}
            {...this.props} />
          : <p className='lead text-center'>
            {activePattern
              ? <span>
                Choose a calendar to edit timetables or
                {' '}
                <Button
                  bsStyle='success'
                  onClick={this._createNewCalendar}>
                  create a new one
                </Button>
              </span>
              : <span>Choose a trip pattern.</span>
            }
          </p>
        }
      </div>
    )
  }
}
