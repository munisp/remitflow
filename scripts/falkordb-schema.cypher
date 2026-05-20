-- FalkorDB Graph Schema for RemitFlow
-- Run these queries when FalkorDB is available:
-- redis-cli -h localhost -p 6379

-- Create User nodes
GRAPH.QUERY remitflow "CREATE (:User {id: 'u1', name: 'Amara Osei', country: 'GH', risk_score: 0.12})"
GRAPH.QUERY remitflow "CREATE (:User {id: 'u2', name: 'Fatima Al-Hassan', country: 'NG', risk_score: 0.08})"

-- Create Beneficiary nodes
GRAPH.QUERY remitflow "CREATE (:Beneficiary {id: 'b1', name: 'John Smith', country: 'GB', bank: 'Barclays'})"

-- Create Transaction nodes
GRAPH.QUERY remitflow "CREATE (:Transaction {id: 'tx1', amount: 500.00, currency: 'USD', status: 'completed'})"

-- Create relationships
GRAPH.QUERY remitflow "MATCH (u:User {id: 'u1'}), (b:Beneficiary {id: 'b1'}) CREATE (u)-[:SENT_TO {count: 5}]->(b)"
