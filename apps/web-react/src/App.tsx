import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RequireAuth, RequireAdmin } from './components/ProtectedRoute'
import Nav from './components/Nav'
import Home from './pages/Home'
import Login from './pages/Login'
import Links from './pages/Links'
import Partners from './pages/admin/Partners'
import Commissions from './pages/admin/Commissions'

export default function App() {
  return (
    <AuthProvider>
      <Nav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route element={<RequireAuth />}>
          <Route path="/links" element={<Links />} />
        </Route>
        <Route element={<RequireAdmin />}>
          <Route path="/admin/partners" element={<Partners />} />
          <Route path="/admin/commissions" element={<Commissions />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
