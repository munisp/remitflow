import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, AlertTriangle, Activity, TrendingUp, Search, Filter,
  AlertCircle, CheckCircle, XCircle, Clock, Eye, Download
} from 'lucide-react';
import api from '@/lib/api';

const SEVERITY_COLORS = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  info: 'bg-gray-500'
};

const ATTACK_TYPES = [
  'brute_force', 'sql_injection', 'xss', 'ddos', 'malware',
  'phishing', 'insider_threat', 'ransomware', 'data_exfiltration'
];

export default function SecurityMonitoringDashboard() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  
  const [stats, setStats] = useState({
    total_alerts: 0,
    critical_alerts: 0,
    high_alerts: 0,
    medium_alerts: 0,
    low_alerts: 0,
    active_incidents: 0,
    resolved_incidents: 0,
    threat_indicators: 0
  });

  const [wazuhAlerts, setWazuhAlerts] = useState([]);
  const [openctiIndicators, setOpenctiIndicators] = useState([]);
  const [openappsecEvents, setOpenappsecEvents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    fetchSecurityData();
    const interval = setInterval(fetchSecurityData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchSecurityData = async () => {
    try {
      setLoading(true);
      
      // Fetch from security monitoring service
      const [statsRes, wazuhRes, openctiRes, openappsecRes, incidentsRes] = await Promise.all([
        api.security.getStats(),
        api.security.getWazuhAlerts({ limit: 50 }),
        api.security.getOpenctiIndicators({ limit: 50 }),
        api.security.getOpenappsecEvents({ limit: 50 }),
        api.security.getIncidents({ status: 'all', limit: 20 })
      ]);

      setStats(statsRes);
      setWazuhAlerts(wazuhRes.alerts || []);
      setOpenctiIndicators(openctiRes.indicators || []);
      setOpenappsecEvents(openappsecRes.events || []);
      setIncidents(incidentsRes.incidents || []);

      // Combine recent activity
      const activity = [
        ...wazuhRes.alerts.slice(0, 10).map(a => ({ ...a, source: 'wazuh', type: 'alert' })),
        ...openctiRes.indicators.slice(0, 10).map(i => ({ ...i, source: 'opencti', type: 'indicator' })),
        ...openappsecRes.events.slice(0, 10).map(e => ({ ...e, source: 'openappsec', type: 'event' }))
      ].sort((a, b) => new Date(b.timestamp || b.created_at) - new Date(a.timestamp || a.created_at)).slice(0, 20);
      
      setRecentActivity(activity);
    } catch (error) {
      console.error('Error fetching security data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateIncident = async (alertId, source) => {
    try {
      await api.security.createIncident({
        alert_id: alertId,
        source: source,
        severity: 'high',
        description: `Incident created from ${source} alert`
      });
      await fetchSecurityData();
    } catch (error) {
      console.error('Error creating incident:', error);
    }
  };

  const handleResolveIncident = async (incidentId) => {
    try {
      await api.security.updateIncident(incidentId, {
        status: 'resolved',
        resolution: 'Resolved by security team'
      });
      await fetchSecurityData();
    } catch (error) {
      console.error('Error resolving incident:', error);
    }
  };

  const filteredAlerts = wazuhAlerts.filter(alert => {
    const matchesSearch = searchQuery === '' || 
      alert.rule?.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.agent?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSeverity = filterSeverity === 'all' || alert.rule?.level === filterSeverity;
    return matchesSearch && matchesSeverity;
  });

  const filteredIndicators = openctiIndicators.filter(indicator => {
    const matchesSearch = searchQuery === '' ||
      indicator.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      indicator.pattern?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const filteredEvents = openappsecEvents.filter(event => {
    const matchesSearch = searchQuery === '' ||
      event.attack_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.source_ip?.includes(searchQuery);
    const matchesSeverity = filterSeverity === 'all' || event.severity === filterSeverity;
    return matchesSearch && matchesSeverity;
  });

  const getSeverityBadge = (severity) => {
    const colors = {
      critical: 'destructive',
      high: 'destructive',
      medium: 'warning',
      low: 'secondary',
      info: 'secondary'
    };
    return <Badge variant={colors[severity] || 'secondary'}>{severity?.toUpperCase()}</Badge>;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'open': return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'investigating': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'resolved': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'closed': return <XCircle className="h-4 w-4 text-gray-500" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  if (loading && wazuhAlerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Activity className="h-12 w-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-gray-600">Loading security data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-purple-600" />
            Security Monitoring
          </h1>
          <p className="text-gray-600 mt-1">Real-time security alerts and threat intelligence</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSecurityData}>
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Alerts</p>
                <p className="text-3xl font-bold">{stats.total_alerts}</p>
              </div>
              <AlertTriangle className="h-10 w-10 text-purple-600" />
            </div>
            <div className="mt-4 flex gap-2 text-xs">
              <span className="text-red-600">Critical: {stats.critical_alerts}</span>
              <span className="text-orange-600">High: {stats.high_alerts}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Incidents</p>
                <p className="text-3xl font-bold">{stats.active_incidents}</p>
              </div>
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              Resolved: {stats.resolved_incidents}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Threat Indicators</p>
                <p className="text-3xl font-bold">{stats.threat_indicators}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-orange-600" />
            </div>
            <div className="mt-4 text-xs text-gray-600">
              From OpenCTI
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Security Score</p>
                <p className="text-3xl font-bold text-green-600">85%</p>
              </div>
              <Shield className="h-10 w-10 text-green-600" />
            </div>
            <div className="mt-4 text-xs text-green-600">
              ↑ 5% from last week
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search alerts, indicators, or events..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="border rounded-md px-4 py-2"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="border rounded-md px-4 py-2"
            >
              <option value="all">All Sources</option>
              <option value="wazuh">Wazuh</option>
              <option value="opencti">OpenCTI</option>
              <option value="openappsec">OpenAppSec</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="wazuh">Wazuh Alerts ({wazuhAlerts.length})</TabsTrigger>
          <TabsTrigger value="opencti">OpenCTI ({openctiIndicators.length})</TabsTrigger>
          <TabsTrigger value="openappsec">OpenAppSec ({openappsecEvents.length})</TabsTrigger>
          <TabsTrigger value="incidents">Incidents ({incidents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Security Activity</CardTitle>
              <CardDescription>Latest alerts, indicators, and events from all sources</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentActivity.slice(0, 15).map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-2 h-2 rounded-full ${
                        item.severity === 'critical' ? 'bg-red-500' :
                        item.severity === 'high' ? 'bg-orange-500' :
                        item.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{item.source}</Badge>
                          {getSeverityBadge(item.severity || 'info')}
                          <span className="font-medium">
                            {item.rule?.description || item.name || item.attack_type || 'Security Event'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {item.agent?.name || item.pattern || item.source_ip || 'N/A'} • 
                          {new Date(item.timestamp || item.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleCreateIncident(item.id, item.source)}>
                      <Eye className="h-4 w-4 mr-1" />
                      Investigate
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wazuh" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Wazuh SIEM Alerts</CardTitle>
              <CardDescription>Security alerts from Wazuh monitoring agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredAlerts.map((alert, index) => (
                  <div key={index} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getSeverityBadge(alert.rule?.level > 12 ? 'critical' : alert.rule?.level > 7 ? 'high' : alert.rule?.level > 4 ? 'medium' : 'low')}
                          <span className="font-medium">{alert.rule?.description}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                          <div>Agent: {alert.agent?.name || 'N/A'}</div>
                          <div>Rule ID: {alert.rule?.id}</div>
                          <div>IP: {alert.agent?.ip || 'N/A'}</div>
                          <div>Time: {new Date(alert.timestamp).toLocaleString()}</div>
                        </div>
                        {alert.full_log && (
                          <div className="mt-2 p-2 bg-gray-100 rounded text-xs font-mono">
                            {alert.full_log.substring(0, 200)}...
                          </div>
                        )}
                      </div>
                      <Button size="sm" onClick={() => handleCreateIncident(alert.id, 'wazuh')}>
                        Create Incident
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="opencti" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>OpenCTI Threat Intelligence</CardTitle>
              <CardDescription>Threat indicators and intelligence from OpenCTI</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredIndicators.map((indicator, index) => (
                  <div key={index} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge>{indicator.indicator_type || 'Unknown'}</Badge>
                          <span className="font-medium">{indicator.name}</span>
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>Pattern: <code className="bg-gray-100 px-2 py-1 rounded">{indicator.pattern}</code></div>
                          <div>Confidence: {indicator.confidence}%</div>
                          <div>Valid Until: {new Date(indicator.valid_until).toLocaleDateString()}</div>
                        </div>
                        {indicator.description && (
                          <p className="mt-2 text-sm">{indicator.description}</p>
                        )}
                      </div>
                      <Button size="sm" variant="outline">
                        View Details
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="openappsec" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>OpenAppSec Application Security</CardTitle>
              <CardDescription>Application security events and attack attempts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredEvents.map((event, index) => (
                  <div key={index} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getSeverityBadge(event.severity)}
                          <Badge variant="outline">{event.attack_type}</Badge>
                          <span className="font-medium">{event.description || 'Security Event'}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm text-gray-600">
                          <div>Source IP: {event.source_ip}</div>
                          <div>Target: {event.target_url}</div>
                          <div>Action: {event.action}</div>
                        </div>
                        {event.details && (
                          <div className="mt-2 p-2 bg-gray-100 rounded text-xs">
                            {JSON.stringify(event.details, null, 2).substring(0, 200)}...
                          </div>
                        )}
                      </div>
                      <Button size="sm" onClick={() => handleCreateIncident(event.id, 'openappsec')}>
                        Create Incident
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Incidents</CardTitle>
              <CardDescription>Active and resolved security incidents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {incidents.map((incident) => (
                  <div key={incident.id} className="p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatusIcon(incident.status)}
                          {getSeverityBadge(incident.severity)}
                          <span className="font-medium">Incident #{incident.id}</span>
                        </div>
                        <p className="text-sm mb-2">{incident.description}</p>
                        <div className="grid grid-cols-3 gap-2 text-sm text-gray-600">
                          <div>Source: {incident.source}</div>
                          <div>Created: {new Date(incident.created_at).toLocaleString()}</div>
                          <div>Status: {incident.status}</div>
                        </div>
                        {incident.resolution && (
                          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-sm">
                            Resolution: {incident.resolution}
                          </div>
                        )}
                      </div>
                      {incident.status !== 'resolved' && incident.status !== 'closed' && (
                        <Button size="sm" variant="outline" onClick={() => handleResolveIncident(incident.id)}>
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Resolve
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

