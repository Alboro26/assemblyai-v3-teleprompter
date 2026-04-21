import { Routes, Route } from 'react-router'
import Interview from './pages/Interview'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Interview />} />
    </Routes>
  )
}
