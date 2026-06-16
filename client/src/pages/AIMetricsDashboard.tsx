import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, TrendingUp, AlertTriangle, CheckCircle2, BarChart3, Zap, Activity, Shield } from "lucide-react";
import { useTranslation } from 'react-i18next';

function MetricCard({ label, value, unit, color, icon: Icon, description }: {
  label: string; value: string | number; unit?: string; color: string; icon: any; description?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-bold">
          {typeof value === "number" ? (value * 100).toFixed(1) : value}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

function FeatureBar({ feature, importance, direction }: { feature: string; importance: number; direction: string }) {
  const width = Math.round(importance * 100);
  const color = direction === "positive" ? "bg-red-400" : direction === "negative" ? "bg-green-400" : "bg-yellow-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">{feature}</span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs capitalize">{direction}</Badge>
          <span className="text-muted-foreground">{(importance * 100).toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function LoadingMetrics() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="pt-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AIMetricsDashboard() {
  const { t } = useTranslation();
  const [featureModel, setFeatureModel] = useState<"fraud_detection" | "compliance_ml" | "risk_scoring">("fraud_detection");

  const { data: metrics, isLoading: metricsLoading } = trpc.mlInsights.getModelMetrics.useQuery();
  const { data: featureData, isLoading: featuresLoading } = trpc.mlInsights.getFeatureImportance.useQuery({ model: featureModel });
  const { data: drift, isLoading: driftLoading } = trpc.mlInsights.detectDrift.useQuery();
  const { data: aiStatus, isLoading: statusLoading } = trpc.aiHub.status.useQuery(undefined, { refetchInterval: 30000 });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-500" />
              AI / ML Metrics Dashboard
            </h1>
            <p className="text-muted-foreground">
              Real-time model performance, feature importance, and drift detection
            </p>
          </div>
          <div className="flex items-center gap-2">
            {statusLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <Badge variant={aiStatus?.services?.qdrant?.available ? "default" : "secondary"} className="text-xs">
                {aiStatus?.services?.qdrant?.available ? "AI Services Online" : "Mock Mode"}
              </Badge>
            )}
          </div>
        </div>

        {/* Service Health Row */}
        {statusLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Qdrant", key: "qdrant", icon: Zap, color: "text-teal-500" },
              { label: "FalkorDB", key: "falkordb", icon: Activity, color: "text-purple-500" },
              { label: "Ollama", key: "ollama", icon: Brain, color: "text-blue-500" },
              { label: "Lakehouse", key: "lakehouse", icon: BarChart3, color: "text-orange-500" },
            ].map(({ label, key, icon: Icon, color }) => {
              const svc = (aiStatus?.services as any)?.[key];
              const online = svc?.available ?? false;
              return (
                <Card key={key}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${color}`} />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <div className={`w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-gray-400"}`} />
                      <span className="text-xs text-muted-foreground">{online ? "Online" : "Mock Mode"}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Tabs defaultValue="models">
          <TabsList className="grid grid-cols-3 w-full max-w-lg">
            <TabsTrigger value="models">Model Performance</TabsTrigger>
            <TabsTrigger value="features">Feature Importance</TabsTrigger>
            <TabsTrigger value="drift">Drift Detection</TabsTrigger>
          </TabsList>

          {/* Model Performance */}
          <TabsContent value="models" className="space-y-6">
            {metricsLoading ? (
              <LoadingMetrics />
            ) : metrics ? (
              <>
                {/* Fraud Detection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Shield className="w-4 h-4 text-red-500" />
                      Fraud Detection Model
                      <Badge variant="outline" className="text-xs ml-auto">v3.2.1</Badge>
                    </CardTitle>
                    <CardDescription>
                      Trained on {metrics.fraudDetection.trainingSize.toLocaleString()} samples · Last trained {new Date(metrics.fraudDetection.lastTrainedAt).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <MetricCard label="Accuracy" value={metrics.fraudDetection.accuracy} unit="%" color="text-green-500" icon={CheckCircle2} />
                      <MetricCard label="Precision" value={metrics.fraudDetection.precision} unit="%" color="text-blue-500" icon={TrendingUp} />
                      <MetricCard label="Recall" value={metrics.fraudDetection.recall} unit="%" color="text-purple-500" icon={Activity} />
                      <MetricCard label="AUC-ROC" value={metrics.fraudDetection.auc} unit="%" color="text-teal-500" icon={BarChart3} />
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-sm">
                        <p className="text-xs text-muted-foreground">False Positive Rate</p>
                        <p className="text-lg font-bold text-red-600">{(metrics.fraudDetection.falsePositiveRate * 100).toFixed(2)}%</p>
                        <p className="text-xs text-muted-foreground">Legitimate transactions flagged</p>
                      </div>
                      <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg text-sm">
                        <p className="text-xs text-muted-foreground">False Negative Rate</p>
                        <p className="text-lg font-bold text-orange-600">{(metrics.fraudDetection.falseNegativeRate * 100).toFixed(2)}%</p>
                        <p className="text-xs text-muted-foreground">Fraud missed by model</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Compliance ML */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      Compliance ML Model
                      <Badge variant="outline" className="text-xs ml-auto">v2.1.0</Badge>
                    </CardTitle>
                    <CardDescription>
                      Trained on {metrics.complianceML.trainingSize.toLocaleString()} samples · Last trained {new Date(metrics.complianceML.lastTrainedAt).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <MetricCard label="Accuracy" value={metrics.complianceML.accuracy} unit="%" color="text-green-500" icon={CheckCircle2} />
                      <MetricCard label="Precision" value={metrics.complianceML.precision} unit="%" color="text-blue-500" icon={TrendingUp} />
                      <MetricCard label="Recall" value={metrics.complianceML.recall} unit="%" color="text-purple-500" icon={Activity} />
                      <MetricCard label="AUC-ROC" value={metrics.complianceML.auc} unit="%" color="text-teal-500" icon={BarChart3} />
                    </div>
                  </CardContent>
                </Card>

                {/* Risk Scoring */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BarChart3 className="w-4 h-4 text-blue-500" />
                      Risk Scoring Model
                      <Badge variant="outline" className="text-xs ml-auto">v1.8.3</Badge>
                    </CardTitle>
                    <CardDescription>
                      Trained on {metrics.riskScoring.trainingSize.toLocaleString()} samples · Last trained {new Date(metrics.riskScoring.lastTrainedAt).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <MetricCard label="Accuracy" value={metrics.riskScoring.accuracy} unit="%" color="text-green-500" icon={CheckCircle2} />
                      <MetricCard label="MSE" value={(metrics.riskScoring.mse * 100).toFixed(2)} unit="%" color="text-orange-500" icon={AlertTriangle} description="Mean Squared Error" />
                      <MetricCard label="MAE" value={(metrics.riskScoring.mae * 100).toFixed(2)} unit="%" color="text-yellow-500" icon={Activity} description="Mean Absolute Error" />
                      <MetricCard label="R² Score" value={metrics.riskScoring.r2Score} unit="%" color="text-teal-500" icon={TrendingUp} />
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No metrics available</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Feature Importance */}
          <TabsContent value="features" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Feature Importance (SHAP Values)</CardTitle>
                  <Select value={featureModel} onValueChange={(v) => setFeatureModel(v as any)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fraud_detection">Fraud Detection</SelectItem>
                      <SelectItem value="compliance_ml">Compliance ML</SelectItem>
                      <SelectItem value="risk_scoring">Risk Scoring</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <CardDescription>
                  Features ranked by their contribution to model predictions. Red = increases risk, Green = decreases risk.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {featuresLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : featureData?.features?.length ? (
                  <div className="space-y-3">
                    {featureData.features.map((f: any) => (
                      <FeatureBar key={f.feature} feature={f.feature} importance={f.importance} direction={f.direction} />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No feature data available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Drift Detection */}
          <TabsContent value="drift" className="space-y-4">
            {driftLoading ? (
              <LoadingMetrics />
            ) : drift ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="w-4 h-4 text-blue-500" />
                    Model Drift Detection
                    <Badge variant={drift.driftDetected ? "destructive" : "default"} className="ml-auto">
                      {drift.driftDetected ? "Drift Detected" : "Stable"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Last checked: {new Date(drift.lastCheckedAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="p-3 border rounded-lg">
                      <p className="text-xs text-muted-foreground">Recent Avg Risk</p>
                      <p className="text-xl font-bold">{(drift.metrics.recentAvgRisk * 100).toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Baseline: {(drift.metrics.baselineAvgRisk * 100).toFixed(1)}%</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <p className="text-xs text-muted-foreground">KS Statistic</p>
                      <p className="text-xl font-bold">{drift.metrics.ksStatistic.toFixed(3)}</p>
                      <p className="text-xs text-muted-foreground">Threshold: {drift.metrics.driftThreshold}</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <p className="text-xs text-muted-foreground">Baseline Tx Count</p>
                      <p className="text-xl font-bold">{drift.metrics.baselineTxCount.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Recent: {drift.metrics.recentTxCount.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      <p className="text-sm">{drift.recommendation}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
