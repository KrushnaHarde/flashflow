import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import authApi from '../services/authApi';
import Card, { CardBody, CardHeader } from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import { User, Mail, ShieldAlert, Calendar, LogOut } from 'lucide-react';
import { toast } from 'react-toastify';

export const Profile = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const data = await authApi.getMe();
      setProfile(data);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      toast.error('Failed to load profile details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully.');
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-md mx-auto text-center">
        <Card className="p-8">
          <p className="text-slate-500">Could not fetch profile details.</p>
          <Button className="mt-4" onClick={fetchProfile}>Retry</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-6">
      <Card>
        <CardHeader className="flex items-center space-x-3">
          <div className="h-10 w-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-lg uppercase">
            {profile.name?.[0] || 'U'}
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">{profile.name}</h2>
            <p className="text-xs text-slate-500 capitalize">{profile.role?.toLowerCase()}</p>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          {/* Email */}
          <div className="flex items-center space-x-3 text-slate-600">
            <Mail className="h-5 w-5 text-slate-400" />
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Email Address
              </span>
              <span className="text-sm font-medium text-slate-800">{profile.email}</span>
            </div>
          </div>

          {/* Role Badge */}
          <div className="flex items-center space-x-3 text-slate-600">
            <ShieldAlert className="h-5 w-5 text-slate-400" />
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                System Role
              </span>
              <div className="mt-0.5">
                <Badge variant={profile.role === 'ADMIN' ? 'danger' : 'info'}>
                  {profile.role}
                </Badge>
              </div>
            </div>
          </div>

          {/* User ID */}
          <div className="flex items-center space-x-3 text-slate-600">
            <User className="h-5 w-5 text-slate-400" />
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                User ID
              </span>
              <span className="text-xs font-mono text-slate-600">{profile.id}</span>
            </div>
          </div>

          {/* Registration Date */}
          {profile.createdAt && (
            <div className="flex items-center space-x-3 text-slate-600">
              <Calendar className="h-5 w-5 text-slate-400" />
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Registration Date
                </span>
                <span className="text-sm text-slate-800">
                  {new Date(profile.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          )}

          {/* Logout Action */}
          <div className="border-t border-slate-100 pt-5 flex justify-end">
            <Button variant="danger" className="w-full sm:w-auto" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign Out
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

export default Profile;
