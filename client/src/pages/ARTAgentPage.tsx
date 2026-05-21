import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, Wrench, CheckCircle2, ArrowRight, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function ARTAgentPage() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [maxSteps, setMaxSteps] = useState(5);
  const [result, setResult] = useState<any>(null);

  const { data: toolsData } = trpc.artAgent.getTools.useQuery();

  const runMutation = trpc.artAgent.run.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success(`ART agent completed in ${data.steps?.length || 0} steps`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRun = () => {
    if (!question.trim()) {
      toast.error("Please enter a question");
      return;
    }
    setResult(null);
    runMutation.mutate({ question, maxSteps });
  };

  const EXAMPLE_QUESTIONS = toolsData?.exampleQuestions || [
    "What is the fee for sending $500 from USD to NGN?",
    "Is sending $10,000 to Iran high risk?",
    "What is the current exchange rate from GBP to KES?",
    "Assess the risk of a $8,000 transfer to a new beneficiary in Nigeria",
  ];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-orange-500" />
            ART Agent
          </h1>
          <p className="text-muted-foreground mt-1">
            Adaptive Reasoning &amp; Tools — multi-step reasoning with domain-specific tool use
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          ReAct Framework
        </Badge>
      </div>

      {/* Tools Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(toolsData?.tools || []).map((tool: any) => (
          <Card key={tool.name} className="border border-orange-100 dark:border-orange-900">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="h-4 w-4 text-orange-500" />
                <span className="font-medium text-sm font-mono">{tool.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{tool.description}</p>
              <div className="flex gap-1 mt-2 flex-wrap">
                {tool.params.map((p: string) => (
                  <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Query Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-500" />
            Ask the ART Agent
          </CardTitle>
          <CardDescription>
            The agent will reason step-by-step, selecting and calling tools to answer your question
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              placeholder="Ask a question about remittances, fees, risk, or compliance..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRun()}
              className="flex-1"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Max steps:</label>
              <Input
                type="number"
                value={maxSteps}
                onChange={(e) => setMaxSteps(parseInt(e.target.value) || 5)}
                className="w-16"
                min={1}
                max={10}
              />
            </div>
            <Button onClick={handleRun} disabled={runMutation.isPending || !question.trim()}>
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}
              Run Agent
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Examples:</span>
            {EXAMPLE_QUESTIONS.map((q: string, i: number) => (
              <button
                key={i}
                onClick={() => setQuestion(q)}
                className="text-xs border rounded-full px-3 py-1 hover:bg-accent transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Agent Trace */}
      {runMutation.isPending && (
        <Card className="border-orange-200 dark:border-orange-800">
          <CardContent className="py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Agent is reasoning and calling tools...</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          {/* Final Answer */}
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Final Answer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{result.answer}</p>
              <div className="flex gap-2 mt-3">
                <Badge variant="outline">{result.steps?.length || 0} steps</Badge>
                {result.model && <Badge variant="outline">{result.model}</Badge>}
                {result.usedFallback && <Badge variant="secondary">Fallback LLM</Badge>}
              </div>
            </CardContent>
          </Card>

          {/* Reasoning Trace */}
          {result.steps?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Reasoning Trace</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.steps.map((step: any, i: number) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-7 w-7 rounded-full bg-orange-500/10 flex items-center justify-center text-xs font-bold text-orange-600">
                          {i + 1}
                        </div>
                        {i < result.steps.length - 1 && <div className="w-0.5 h-full bg-border mt-1" />}
                      </div>
                      <div className="flex-1 pb-3">
                        {step.thought && (
                          <div className="mb-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase">Thought</span>
                            <p className="text-sm mt-0.5">{step.thought}</p>
                          </div>
                        )}
                        {step.action && (
                          <div className="mb-2 flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase">Action</span>
                            <Badge variant="outline" className="font-mono text-xs">
                              <Wrench className="h-3 w-3 mr-1" />
                              {step.action}
                            </Badge>
                            {step.actionInput && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {JSON.stringify(step.actionInput)}
                              </span>
                            )}
                          </div>
                        )}
                        {step.observation && (
                          <div className="flex items-start gap-2">
                            <ArrowRight className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-1">
                              {typeof step.observation === "string" ? step.observation : JSON.stringify(step.observation)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
