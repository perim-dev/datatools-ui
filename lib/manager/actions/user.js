// @flow

import objectPath from 'object-path'
import {browserHistory} from 'react-router'
import {createAction, type ActionType} from 'redux-actions'
import type { Auth0ContextInterface } from '@auth0/auth0-react'

import {fetchUsers} from '../../admin/actions/admin'
import {createVoidPayloadAction, secureFetch} from '../../common/actions'
import { AUTH0_CLIENT_ID, AUTH0_CONNECTION_NAME, AUTH0_DOMAIN } from '../../common/constants'
import UserPermissions from '../../common/user/UserPermissions'
import type {RecentActivity, UserProfile} from '../../types'
import type {dispatchFn, getStateFn, ManagerUserState} from '../../types/reducers'

import {fetchProjects} from './projects'
import {fetchProjectFeeds} from './feeds'
import {setErrorMessage} from './status'

const receiveRecentActivity = createAction(
  'RECEIVE_USER_RECENT_ACTIVITY',
  (payload: Array<RecentActivity>) => payload
)
const updatingUserData = createVoidPayloadAction('UPDATING_USER_DATA')
const userLoggedIn = createAction(
  'USER_LOGGED_IN',
  (payload: {
    permissions: UserPermissions,
    profile: any,
    token: string
  }) => payload
)
const userLogout = createVoidPayloadAction('USER_LOGGED_OUT')
const userProfileUpdated = createAction(
  'USER_PROFILE_UPDATED',
  (payload: UserProfile) => payload
)

export type UserActions =
  ActionType<typeof receiveRecentActivity> |
  ActionType<typeof updatingUserData> |
  ActionType<typeof userLoggedIn> |
  ActionType<typeof userLogout> |
  ActionType<typeof userProfileUpdated>

/**
 * Utility function to find the client/application-specific entry in the datatools
 * metadata object.
 */
function findClientId (datatoolsObject) {
  return datatoolsObject.client_id === process.env.AUTH0_CLIENT_ID
}

// server call
export function createPublicUser (credentials: any) {
  window.alert('This feature is no longer maintained')
  // const url = '/api/manager/public/user'
  // return fetchAction({
  //   next: (err, res) => {
  //     if (err) {
  //       return alert('An error occurred while trying to create the user.')
  //     }
  //     return createdPublicUser(res)
  //   },
  //   options: {
  //     body: credentials,
  //     method: 'POST'
  //   },
  //   url
  // })
}

/**
 * Fetch the recent activity for the user's subscriptions.
 */
export function getRecentActivity (user: ManagerUserState) {
  return function (dispatch: dispatchFn, getState: getStateFn) {
    if (!user.profile) throw new Error('Profile does not exist in user state')
    const {user_id: userId} = user.profile
    const url = `/api/manager/secure/user/${userId}/recentactivity`
    return dispatch(secureFetch(url))
      .then(response => response.json())
      .then(activity => dispatch(receiveRecentActivity(activity)))
  }
}

/**
 * Log user out from auth0 and from redux store.
 * @return {Action}  The userLogout action
 */
export function logout (auth0Interface: Auth0ContextInterface) {
  if (auth0Interface.isAuthenticated) {
    auth0Interface.logout({ returnTo: window.location.origin })
  }
  return userLogout()
}

/**
 * Resends the Auth0 email confirmation message (which is auto-sent on user
 * signup) for a given user. Returns a promise with a resulting value of true if
 * the email was successfully sent.
 */
export function resendEmailConfirmation (user: ManagerUserState): Promise<boolean> {
  // $FlowFixMe flow says async function is incompatible with a Promise
  return async function (dispatch: dispatchFn, getState: getStateFn) {
    if (!user.profile || !user.profile.user_id) {
      throw new Error('User profile missing ID!')
    }
    const response = await dispatch(
      secureFetch(`/api/manager/secure/user/${user.profile.user_id}/resendEmailConfirmation`)
    )
    const json = await response.json()
    return json.emailSent
  }
}

/**
 * Sends a password reset email using the
 * https://auth0.com/docs/api/authentication#change-password endpoint.
 * Returns a promise with a resulting value of true if the email was successfully sent.
 */
export function sendPasswordReset (user: ManagerUserState) {
  return async function (dispatch: dispatchFn, getState: getStateFn) {
    if (!user.profile || !user.profile.email) {
      throw new Error('User profile missing email!')
    }
    const response = await dispatch(
      secureFetch(
        `https://${AUTH0_DOMAIN}/dbconnections/change_password`,
        'POST',
        {
          client_id: AUTH0_CLIENT_ID,
          connection: AUTH0_CONNECTION_NAME,
          email: user.profile.email
        },
        true // return the response object itself.
      )
    )
    alert(response.ok
      ? 'We have sent you an email with instructions for changing your password.'
      : 'There was an error sending the email to change your password.'
    )
  }
}

export function receiveTokenAndProfile (authResult: {profile: UserProfile, token: string}) {
  const { token, profile } = authResult
  if (!profile.app_metadata) {
    // If app_metadata field is not available, look for app_metadata in scoped
    // fields from Auth0 token. More information on setting up a rule to provide
    // this scoped field can be found at https://community.auth0.com/t/how-can-i-make-app-metadata-available-in-userinfo-endpoint/6664/4
    if (profile['http://datatools/app_metadata']) {
      profile.app_metadata = profile['http://datatools/app_metadata']
      profile.user_metadata = profile['http://datatools/user_metadata']
    } else {
      throw new Error('Auth0 user authentication is not configured properly!')
    }
  }
  return userLoggedIn({
    token,
    profile,
    permissions: new UserPermissions(profile.app_metadata.datatools)
  })
}

/**
 * Unsubscribe user from all subscriptions.
 */
export function unsubscribeAll (profile: UserProfile) {
  return function (dispatch: dispatchFn, getState: getStateFn) {
    return dispatch(updateUserData(profile, {subscriptions: []}))
  }
}

/**
 * Adds or removes a subscription to the provided target (e.g., feed source,
 * project, deployment ID) for the requesting user.
 */
export function updateTargetForSubscription (profile: UserProfile, target: string, subscriptionType: string) {
  return function (dispatch: dispatchFn, getState: getStateFn) {
    const subscriptions = profile.app_metadata.datatools.find(findClientId).subscriptions ||
      [{type: subscriptionType, target: []}]
    if (subscriptions.findIndex(sub => sub.type === subscriptionType) === -1) {
      subscriptions.push({type: subscriptionType, target: []})
    }
    for (let i = 0; i < subscriptions.length; i++) {
      const sub = subscriptions[i]
      if (sub.type === subscriptionType) {
        const index = sub.target.indexOf(target)
        if (index > -1) {
          sub.target.splice(index, 1)
        } else {
          sub.target.push(target)
        }
      }
    }
    return dispatch(updateUserData(profile, {subscriptions}))
  }
}

/**
 * Update application/client ID specific datatools object with provided user
 * data. This is used in the user admin module to update some user's permissions
 * as well as throughout the application to update attributes for the logged in
 * user (e.g., when a user subscribes/watches a feed source or project).
 */
export function updateUserData (user: any, userData: any) {
  return function (dispatch: dispatchFn, getState: getStateFn) {
    dispatch(updatingUserData())
    // FIXME: Currently there are some implementations of this method that pass
    // profile as an argument and others that pass user.
    const profile = user.profile || user
    const metadata = profile.app_metadata
    const clientIndex = metadata.datatools.findIndex(findClientId)
    if (clientIndex === -1) {
      return dispatch(setErrorMessage({
        message: `Could not find user metadata\n${JSON.stringify(user)}`
      }))
    }
    // Update each key in existing datatools object with updated user data.
    for (const key in userData) {
      objectPath.set(metadata, `datatools.${clientIndex}.${key}`, userData[key])
    }
    const url = `/api/manager/secure/user/${user.user_id}`
    const payload = {
      user_id: profile.user_id,
      data: metadata.datatools
    }
    let status
    // Make request to server
    return dispatch(secureFetch(url, 'put', payload))
      .then(response => {
        status = response.status
        return response.json()
      })
      .then(responseJson => {
        if (status >= 400) {
          return dispatch(setErrorMessage({
            message: `Could not update user metadata\n${JSON.stringify(responseJson)}`
          }))
        }
        const {profile} = getState().user
        if (!profile) throw new Error('Could not find user profile in state.')
        if (responseJson.user_id === profile.user_id) {
          // If user being updated matches the logged in user, update their
          // profile in the application state as the change in user_metdata can
          // change various items in the application such as user subscriptions
          // or even permissions a user has available to them.
          dispatch(userProfileUpdated(responseJson))
        } else {
          dispatch(fetchUsers())
        }
      })
  }
}

export function onUserHomeMount (user: ?ManagerUserState, projectId: ?string) {
  return function (dispatch: dispatchFn, getState: getStateFn) {
    if (user) {
      dispatch(getRecentActivity(user))
    }
    dispatch(fetchProjects())
      .then(projects => {
        if (!projectId) {
          const userProjectIds = user && projects.map(p => {
            if (user && user.permissions && user.permissions.hasProject(p.id, p.organizationId)) {
              return p.id
            }
          })
          projectId = userProjectIds && userProjectIds[0]
        }
        if (projectId) {
          const _projectId = projectId
          dispatch(fetchProjectFeeds(_projectId))
            .then(() => browserHistory.push(`/home/${_projectId}`))
        }
      })
  }
}
