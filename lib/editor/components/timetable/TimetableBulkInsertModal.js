// @flow

import React, {Component} from 'react'
import {Modal, Button} from 'react-bootstrap'

import {getComponentMessages} from '../../../common/util/config'
import {SHORTCUTS} from '../../util/timetable'

type Props = {
  onClose: () => void,
  show: boolean
}

type State = {
  showModal: boolean,
  inputText: string
}

export default class TimetableBulkInsertModal extends Component<Props, State> {
  messages = getComponentMessages('TimetableBilkInsertModal')

  componentWillMount () {
    this.setState({
      showModal: this.props.show,
      inputText: '',
    })
  }

  _close = () => {
    const {onClose} = this.props
    onClose && onClose()
  }

  
  render () {
    const {Body, Footer, Header, Title} = Modal
  
    return (
      <Modal
        size="lg"

        show={this.props.show}
        onHide={this._close}>
        <Header closeButton>
          <Title>Data Bulk Insert</Title>
        </Header>
        <Body>
          <textarea rows="10" style={{ width: "100%" }} onChange={e => this.setState({inputText: e.target.value})} value={this.state.inputText}></textarea>
        </Body>
        <Footer>
          <Button onClick={this._close}>Close</Button>
          <Button onClick={() => {
            this.props.updateTripFromText(this.state.inputText)
            this.setState({inputText: ''})
            this._close()
            }}>Insert</Button>
        </Footer>
      </Modal>
    )
  }
}
