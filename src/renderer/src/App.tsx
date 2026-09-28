import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { SettingsProvider, useSettings } from '@/lib/settingsContext';
import { AuthProvider, useAuth } from '@/lib/authContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageSpinner } from '@/components/ui/Spinner';
import FirstRun from '@/pages/FirstRun';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Sponsors from '@/pages/Sponsors';
import SponsorDetail from '@/pages/SponsorDetail';
import Campaigns from '@/pages/Campaigns';
import CampaignDetail from '@/pages/CampaignDetail';
import Coupons from '@/pages/Coupons';
import Batches from '@/pages/Batches';
import ScanValidate from '@/pages/ScanValidate';
import History from '@/pages/History';
import Exports from '@/pages/Exports';
import Settings from '@/pages/Settings';
import Users from '@/pages/Users';
import Reservations from '@/pages/Reservations';
import NewReservation from '@/pages/NewReservation';
import CalendarPage from '@/pages/CalendarPage';
import Customers from '@/pages/Customers';
import BookingSetup from '@/pages/BookingSetup';
import ReservationReports from '@/pages/ReservationReports';

function AppShell() {
  const { settings, loading: settingsLoading, refresh: refreshSettings } = useSettings();
  const { user, loading: authLoading, refresh: refreshAuth, can } = useAuth();
  const [hasAnyUser, setHasAnyUser] = useState<boolean | null>(null);

  useEffect(() => {
    window.api.auth.hasAnyUser().then(setHasAnyUser);
  }, []);

  if (settingsLoading || authLoading || hasAnyUser === null) return <PageSpinner />;

  if (!hasAnyUser) {
    return (
      <FirstRun
        onComplete={async () => {
          await refreshSettings();
          await refreshAuth();
          setHasAnyUser(true);
        }}
      />
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex h-screen bg-base-bg">
      <Sidebar businessName={settings.businessName} />
      <main className="flex-1 overflow-y-auto px-8 py-7">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sponsors" element={<Sponsors />} />
          <Route path="/sponsors/:id" element={<SponsorDetail />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/coupons" element={<Coupons />} />
          <Route path="/batches" element={<Batches />} />
          {can('reservations.view') && <Route path="/reservations" element={<Reservations />} />}
          {can('reservations.create') && <Route path="/reservations/new" element={<NewReservation />} />}
          {can('calendar.view') && <Route path="/calendar" element={<CalendarPage />} />}
          {can('customers.view') && <Route path="/customers" element={<Customers />} />}
          {can('pricing.view') && <Route path="/booking-setup" element={<BookingSetup />} />}
          {can('reports.view') && <Route path="/reservation-reports" element={<ReservationReports />} />}
          <Route path="/scan" element={<ScanValidate />} />
          <Route path="/history" element={<History />} />
          <Route path="/exports" element={<Exports />} />
          <Route path="/settings" element={<Settings />} />
          {can('users.view') && <Route path="/users" element={<Users />} />}
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <AuthProvider>
          <HashRouter>
            <AppShell />
          </HashRouter>
        </AuthProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}
