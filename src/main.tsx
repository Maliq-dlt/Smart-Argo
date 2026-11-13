import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import Site from './Site'
import './styles.css'

// Back from Google without a route (Auth fell back to its site URL): open the dashboard; the account provider finishes sign-in.
if (!location.hash && /[?&](code|error)=/.test(location.search)) history.replaceState(null, '', `${location.pathname}${location.search}#statistik`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><MotionConfig reducedMotion="user"><Site /></MotionConfig></React.StrictMode>,
)
