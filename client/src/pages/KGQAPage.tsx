import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquare, Code2, Sparkles, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

export default function KGQAPage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<any>(null);

  const { data: suggestedData } = trpc.kgqa.suggestedQuestions.useQuery();

  const answerMutation = trpc.kgqa.answer.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success("Question answered");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAsk = () => {
    if (!question.trim()) {
      toast.error("Please enter a question");
      return;
    }
    setResult(null);
    answerMutation.mutate({ question });
  };

  const suggestedQuestions = suggestedData?.questions || [];

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-indigo-500" />
            EPR-KGQA
          </h1>
          <p className="text-muted-foreground mt-1">
            Evidence Pattern Retrieval — Knowledge Graph Question Answering in natural language
          </p>
        </div>
        <Badge variant="outline" className="text-sm px-3 py-1">
          NL → Cypher → Answer
        </Badge>
      </div>

      {/* How it Works */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { step: "1", title: "Natural Language", desc: "Ask a question in plain English about your transaction data", icon: MessageSquare, color: "text-indigo-500" },
          { step: "2", title: "Cypher Generation", desc: "LLM converts your question to a Cypher graph query", icon: Code2, color: "text-purple-500" },
          { step: "3", title: "Graph Answer", desc: "FalkorDB executes the query and returns structured results", icon: Sparkles, color: "text-blue-500" },
        ].map((item) => (
          <Card key={item.step} className="border border-indigo-100 dark:border-indigo-900">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-6 w-6 rounded-full bg-indigo-500/10 flex items-center justify-center text-xs font-bold text-indigo-600">
                  {item.step}
                </div>
                <item.icon className={`h-4 w-4 ${item.color}`} />
                <span className="font-medium text-sm">{item.title}</span>
              </div>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Question Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-indigo-500" />
            Ask a Question
          </CardTitle>
          <CardDescription>
            Query your knowledge graph using natural language
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              placeholder="e.g. How many transactions did user 1 send to Nigeria last month?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              className="flex-1"
            />
            <Button onClick={handleAsk} disabled={answerMutation.isPending || !question.trim()}>
              {answerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
              Ask
            </Button>
          </div>

          {suggestedQuestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Suggested questions:</p>
              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map((q: string, i: number) => (
                  <button
                    key={i}
                    onClick={() => setQuestion(q)}
                    className="text-xs border rounded-full px-3 py-1 hover:bg-accent transition-colors text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Answer */}
      {answerMutation.isPending && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Generating Cypher query and executing...</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          {/* Question Echo */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-medium text-muted-foreground mb-1">Question</p>
              <p className="text-base">{result.question}</p>
            </CardContent>
          </Card>

          {/* Generated Cypher */}
          {result.cypherQuery && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Code2 className="h-4 w-4 text-purple-500" />
                  Generated Cypher Query
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs font-mono bg-muted rounded p-3 overflow-auto">{result.cypherQuery}</pre>
              </CardContent>
            </Card>
          )}

          {/* Answer */}
          <Card className="border-indigo-200 dark:border-indigo-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Answer

              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.naturalLanguageAnswer && (
                <p className="text-sm">{result.naturalLanguageAnswer}</p>
              )}
              {result.rawResults && result.rawResults.length > 0 && (
                <div className="border rounded-lg overflow-auto max-h-60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        {Object.keys(result.rawResults[0]).map((k) => (
                          <th key={k} className="text-left p-2 font-medium">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rawResults.slice(0, 20).map((row: any, i: number) => (
                        <tr key={i} className="border-t">
                          {Object.values(row).map((v: any, j: number) => (
                            <td key={j} className="p-2">{String(v)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.confidence !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Confidence:</span>
                  <Badge variant={result.confidence > 0.7 ? "default" : result.confidence > 0.4 ? "secondary" : "destructive"}>
                    {(result.confidence * 100).toFixed(0)}%
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
