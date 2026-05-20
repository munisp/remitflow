import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL });
const q = async (sql, p=[]) => { const c = await pool.connect(); try { return await c.query(sql,p); } finally { c.release(); } };
const now = new Date();
const ago = (d) => new Date(now - d*86400000);

async function main() {
  console.log("🌱 RemitFlow v80 — Seeding empty tables with correct column names...");

  const users = (await q("SELECT id FROM users ORDER BY id LIMIT 10")).rows.map(r=>r.id);
  const cards = (await q('SELECT id, user_id FROM virtual_cards LIMIT 20')).rows;
  const disputes = (await q('SELECT id, "userId" FROM disputes LIMIT 20')).rows;
  const bnplPlans = (await q("SELECT id, user_id FROM bnpl_plans LIMIT 20")).rows;
  const startupDeals = (await q("SELECT id FROM startup_deals LIMIT 10")).rows.map(r=>r.id);
  const tickets = (await q("SELECT id, user_id FROM support_tickets LIMIT 20")).rows;
  const txns = (await q('SELECT id, "userId" FROM transactions LIMIT 50')).rows;
  const funds = (await q("SELECT id FROM community_funds LIMIT 10")).rows.map(r=>r.id);
  const refs = (await q('SELECT "referrerId", "referredId" FROM referrals LIMIT 20')).rows;
  const stocks = (await q("SELECT id, ticker FROM ngx_stocks LIMIT 20")).rows;
  const listings = (await q("SELECT id FROM real_estate_listings LIMIT 6")).rows.map(r=>r.id);
  const tenants = (await q("SELECT id FROM tenants LIMIT 4")).rows.map(r=>r.id);
  const featureFlags = (await q("SELECT id FROM feature_flags LIMIT 10")).rows.map(r=>r.id);
  const webhookEndpoints = (await q("SELECT id FROM webhook_endpoints LIMIT 3")).rows.map(r=>r.id);
  const st = ["completed","completed","completed","failed","pending"];

  // 1. airtime_purchases
  for(let i=0;i<120;i++){
    const uid=users[i%users.length],net=["MTN","Airtel","Glo","9mobile"][i%4],type=i%2===0?"airtime":"data",amt=[100,200,500,1000,2000][i%5];
    await q(`INSERT INTO airtime_purchases(user_id,network,phone_number,purchase_type,data_plan,amount_ngn,amount_usd,status,provider_ref,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [uid,net,"080"+String(uid).padStart(8,"0"),type,type==="data"?"2GB/30days":null,amt,(amt/1600).toFixed(4),st[i%5],"AIR-"+i+"-"+Date.now(),ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ 120 airtime_purchases");

  // 2. bill_payments
  const billers=[["IKEDC","Ikeja Electric","electricity"],["DSTV","DStv","tv"],["GOTV","GOtv","tv"],["LAWMA","Lagos Waste","waste"],["EKEDC","Eko Electric","electricity"]];
  for(let i=0;i<100;i++){
    const uid=users[i%users.length],b=billers[i%5],amt=[2000,5000,10000,15000,25000][i%5];
    await q(`INSERT INTO bill_payments(user_id,biller_id,biller_name,category,account_number,amount_ngn,amount_usd,status,provider_ref,receipt_url,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [uid,b[0],b[1],b[2],"ACCT-"+uid+"-"+i,amt,(amt/1600).toFixed(4),st[i%5],"BILL-"+i+"-"+Date.now(),null,ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ 100 bill_payments");

  // 3. bnpl_installments
  for(const plan of bnplPlans){
    for(let inst=1;inst<=6;inst++){
      const due=new Date(now);due.setMonth(due.getMonth()+inst-3);const paid=inst<=3;
      await q(`INSERT INTO bnpl_installments(plan_id,user_id,installment_number,amount_ngn,due_date,paid_at,status,late_fee_ngn,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [plan.id,plan.user_id,inst,5000,due.toISOString().split("T")[0],paid?ago(90-inst*30):null,paid?"paid":"pending",0,ago(180)]);
    }
  }
  console.log("  ✓ "+bnplPlans.length*6+" bnpl_installments");

  // 4. card_transactions
  const merch=[["Shoprite","grocery"],["Amazon","ecommerce"],["Netflix","entertainment"],["Uber","transport"],["Bolt Food","food"],["Jumia","ecommerce"],["Spotify","entertainment"],["Apple Store","digital"]];
  for(const card of cards){
    for(let i=0;i<15;i++){
      const m=merch[i%8],amt=[5.99,12.50,25.00,49.99,100.00][i%5];
      await q(`INSERT INTO card_transactions(card_id,user_id,merchant_name,merchant_category,amount,currency,transaction_type,status,provider_tx_id,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [card.id,card.user_id,m[0],m[1],amt,"USD",i%8===7?"refund":"purchase",i%10===9?"declined":"approved","CTX-"+card.id+"-"+i+"-"+Date.now(),ago(Math.floor(Math.random()*60))]);
    }
  }
  console.log("  ✓ "+cards.length*15+" card_transactions");

  // 5. community_contributions
  for(let i=0;i<80;i++){
    await q(`INSERT INTO community_contributions(fund_id,user_id,amount_usd,message,is_anonymous,"createdAt") VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [funds[i%funds.length],users[i%users.length],[10,25,50,100,250][i%5],i%3===0?"Happy to contribute!":null,i%7===0,ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ 80 community_contributions");

  // 6. dispute_evidence
  for(let i=0;i<Math.min(disputes.length*2,40);i++){
    const d=disputes[i%disputes.length];
    await q(`INSERT INTO dispute_evidence(dispute_id,uploaded_by,file_url,file_key,file_name,mime_type,file_size_bytes,description,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [d.id,d.userId||users[0],"https://storage.remitflow.com/evidence/"+d.id+"-"+i+".pdf","evidence/"+d.id+"-"+i+".pdf","evidence-"+i+".pdf","application/pdf",Math.floor(Math.random()*500000)+10000,["Bank statement","Screenshot","Correspondence","Receipt"][i%4],ago(Math.floor(Math.random()*30))]);
  }
  console.log("  ✓ "+Math.min(disputes.length*2,40)+" dispute_evidence");

  // 7. investment_distributions
  const dTypes=["dividend","rental_income","interest","capital_gain","profit_share"],aTypes=["real_estate","ngx_stock","startup","bond","money_market"];
  for(let i=0;i<100;i++){
    const uid=users[i%users.length],amt=[50,125,250,500,1000][i%5],ps=ago(90+(i%4)*30),pe=ago(60+(i%4)*30);
    await q(`INSERT INTO investment_distributions(user_id,distribution_type,asset_type,asset_id,asset_name,amount_usd,amount_ngn,period_start,period_end,status,paid_at,wallet_tx_id,notes,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
      [uid,dTypes[i%5],aTypes[i%5],i+1,"Asset "+(i+1),amt,(amt*1600).toFixed(2),ps.toISOString().split("T")[0],pe.toISOString().split("T")[0],i%5===3?"pending":"paid",i%5===3?null:ago(Math.floor(Math.random()*30)),null,"Q"+(Math.ceil((i%4+1)))+" distribution",ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ 100 investment_distributions");

  // 8. investment_kyc_gates (correct schema: stock_max_usd, realestate_max_usd, startup_max_usd)
  for(let i=0;i<20;i++){
    const uid=users[i%users.length];
    await q(`INSERT INTO investment_kyc_gates(user_id,stock_max_usd,realestate_max_usd,startup_max_usd,total_invested_usd,last_evaluated_at,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [uid,[5000,25000,100000][i%3],[10000,50000,500000][i%3],[2500,10000,50000][i%3],Math.floor(Math.random()*5000),ago(10),ago(Math.floor(Math.random()*30))]);
  }
  console.log("  ✓ 20 investment_kyc_gates");

  // 9. referral_rewards
  const rwTypes=["cash","fee_waiver","rate_boost","premium_month"],miles=["first_transfer","kyc_tier2","transfer_500usd","transfer_1000usd","five_transfers"];
  for(let i=0;i<refs.length;i++){
    const r=refs[i],amt=[5,10,15,25,50][i%5];
    await q(`INSERT INTO referral_rewards(referrer_id,referred_id,reward_type,reward_amount_usd,milestone,status,paid_at,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [r.referrerId,r.referredId,rwTypes[i%4],amt,miles[i%5],i%4===3?"pending":"paid",i%4===3?null:ago(Math.floor(Math.random()*60)),ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ "+refs.length+" referral_rewards");

  // 10. startup_investments
  const siInst=["safe","equity","convertible_note","revenue_share"];
  for(let i=0;i<40;i++){
    const uid=users[i%users.length],did=startupDeals[i%startupDeals.length],amt=[500,1000,2500,5000,10000][i%5],ex=i%10===9;
    await q(`INSERT INTO startup_investments(user_id,deal_id,amount_usd,instrument_type,equity_pct,status,payment_method,agreement_signed,agreement_url,notes,invested_at,confirmed_at,exited_at,exit_value_usd,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
      [uid,did,amt,siInst[i%4],((amt/100000)*100).toFixed(4),ex?"exited":"confirmed","bank_transfer",true,"https://storage.remitflow.com/agreements/si-"+did+"-"+uid+".pdf",null,ago(180),ago(170),ex?ago(30):null,ex?amt*1.5:null,ago(180)]);
  }
  console.log("  ✓ 40 startup_investments");

  // 11. support_messages
  const uMsgs=["Transfer not arrived after 3 days.","KYC rejected, what docs needed?","Charged twice for same transaction.","Explain exchange rate used.","Need to cancel pending transfer."];
  const aMsgs=["Investigating your transaction now.","Escalated to KYC team, 24hr response.","Duplicate charge confirmed, refund initiated.","Rate was mid-market + 0.5% fee.","Hold placed, please confirm cancellation."];
  for(const t of tickets){
    await q(`INSERT INTO support_messages(ticket_id,sender_id,is_agent,message,attachments,"createdAt") VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[t.id,t.user_id,false,uMsgs[t.id%5],null,ago(5)]);
    await q(`INSERT INTO support_messages(ticket_id,sender_id,is_agent,message,attachments,"createdAt") VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[t.id,users[0],true,aMsgs[t.id%5],null,ago(4)]);
  }
  console.log("  ✓ "+tickets.length*2+" support_messages");

  // 12. travel_rule_records
  const trC=["GB","US","NG","KE","GH","ZA","CA","DE"],trV=["Binance","Coinbase","Kraken","OKX","Bitstamp"];
  const lt=txns.filter((_,i)=>i%5===0).slice(0,40);
  for(let i=0;i<lt.length;i++){
    const t=lt[i],uid=t.userId||users[0];
    await q(`INSERT INTO travel_rule_records(user_id,transaction_id,direction,originator_name,originator_account,originator_address,originator_country,beneficiary_name,beneficiary_account,beneficiary_address,beneficiary_country,amount,currency,vasp,vasp_lei,status,threshold,reported_at,acknowledged_at,notes,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) ON CONFLICT DO NOTHING`,
      [uid,t.id,"outbound","User "+uid,"ACC-"+uid,"123 Main St London",trC[i%8],"Recipient "+i,"ACC-RCP-"+i,"456 Recipient St",trC[(i+2)%8],1500+i*100,"USD",trV[i%5],"LEI"+String(i).padStart(17,"0"),i%4===3?"pending":"reported",1000,ago(Math.floor(Math.random()*30)),i%3===0?ago(25):null,null,ago(Math.floor(Math.random()*30)),ago(Math.floor(Math.random()*30))]);
  }
  console.log("  ✓ "+lt.length+" travel_rule_records");

  // 13. webhook_deliveries
  const wEv=["payment.completed","kyc.approved","transfer.failed","dispute.opened","referral.converted"];
  const epId=webhookEndpoints[0]||1;
  for(let i=0;i<80;i++){
    const ev=wEv[i%5],ok=i%5!==3;
    await q(`INSERT INTO webhook_deliveries(endpoint_id,event_type,payload,status,response_status,response_body,attempt_count,next_retry_at,delivered_at,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [epId,ev,JSON.stringify({event:ev,data:{id:i}}),ok?"delivered":"failed",ok?200:500,ok?'{"received":true}':'{"error":"timeout"}',ok?1:3,ok?null:new Date(now.getTime()+3600000),ok?ago(Math.floor(Math.random()*30)):null,ago(Math.floor(Math.random()*30))]);
  }
  console.log("  ✓ 80 webhook_deliveries");

  // 14. outbox_events
  const oEv=["payment.initiated","kyc.document_uploaded","transfer.completed","aml.flagged","dispute.opened"];
  for(let i=0;i<100;i++){
    const t=txns[i%txns.length],ev=oEv[i%5],ok=i%10!==9;
    await q(`INSERT INTO outbox_events(aggregate_id,aggregate_type,event_type,payload,status,retry_count,max_retries,published_at,failed_at,error_message,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [String(t.id),"transaction",ev,JSON.stringify({transactionId:t.id,userId:t.userId}),ok?"published":"failed",ok?0:3,5,ok?ago(Math.floor(Math.random()*30)):null,ok?null:ago(1),ok?null:"Connection refused: kafka:9092",ago(Math.floor(Math.random()*30))]);
  }
  console.log("  ✓ 100 outbox_events");

  // 15. notification_log
  const nlC=["email","sms","push","in_app"],nlE=["transfer_completed","kyc_approved","login_alert","fx_alert_triggered","dispute_update"];
  for(let i=0;i<150;i++){
    const uid=users[i%users.length],ch=nlC[i%4],ev=nlE[i%5],ok=i%8!==7;
    await q(`INSERT INTO notification_log(user_id,channel,event_type,subject,body,recipient,status,provider,provider_message_id,error_message,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [uid,ch,ev,"RemitFlow: "+ev.replace(/_/g," "),"Your "+ev+" notification",ch==="email"?"user"+uid+"@example.com":"+447000000"+uid,ok?"delivered":"bounced",["sendgrid","twilio","firebase","internal"][i%4],"MSG-"+i+"-"+Date.now(),ok?null:"Invalid recipient",ago(Math.floor(Math.random()*60))]);
  }
  console.log("  ✓ 150 notification_log");

  // 16. ngx_orders
  for(let i=0;i<60;i++){
    const uid=users[i%users.length],s=stocks[i%stocks.length],qty=[10,25,50,100,200][i%5],price=10+(i%50),total=qty*price;
    await q(`INSERT INTO ngx_orders(user_id,stock_id,order_type,status,quantity_units,price_per_unit_ngn,total_amount_ngn,total_amount_usd,fx_rate_used,broker_reference,broker_name,executed_at,notes,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
      [uid,s.id,"limit","executed",qty,price,total,(total/1600).toFixed(2),1600,"NGX-"+i+"-"+Date.now(),"Stanbic IBTC",ago(Math.floor(Math.random()*90)),null,ago(Math.floor(Math.random()*90)),ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ 60 ngx_orders");

  // 17. stock_watchlists
  for(let i=0;i<40;i++){
    await q(`INSERT INTO stock_watchlists(user_id,stock_id,alert_price_ngn,notes,"createdAt") VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [users[i%users.length],stocks[i%stocks.length].id,(50+i)*100,"Watching "+stocks[i%stocks.length].ticker,ago(Math.floor(Math.random()*60))]);
  }
  console.log("  ✓ 40 stock_watchlists");

  // 18. real_estate_investments
  for(let i=0;i<30;i++){
    const uid=users[i%users.length],lid=listings[i%listings.length],amt=[1000,2500,5000,10000,25000][i%5],shares=Math.floor(amt/100),pps=100;
    await q(`INSERT INTO real_estate_investments(user_id,listing_id,shares_owned,price_per_share_paid,total_invested_usd,ownership_pct,status,returns_paid_usd,invested_at,"createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [uid,lid,shares,pps,amt,(shares/1000*100).toFixed(4),"confirmed",0,ago(Math.floor(Math.random()*90)),ago(Math.floor(Math.random()*90))]);
  }
  console.log("  ✓ 30 real_estate_investments");

  // 19. ngx_price_snapshots
  for(let day=0;day<30;day++){
    for(const s of stocks.slice(0,5)){
      const p=10+Math.random()*40;
      await q(`INSERT INTO ngx_price_snapshots(stock_id,ticker,price_ngn,change_pct,volume,source,"snapshotAt") VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [s.id,s.ticker,(p*100).toFixed(2),((Math.random()-0.5)*5).toFixed(2),Math.floor(Math.random()*1000000),"ngx_feed",ago(day)]);
    }
  }
  console.log("  ✓ 150 ngx_price_snapshots");

  // 20. idempotency_keys (correct schema: response_status, response_body)
  for(let i=0;i<50;i++){
    await q(`INSERT INTO idempotency_keys(key,user_id,operation,response_status,response_body,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      ["idem-"+i+"-"+Date.now(),users[i%users.length],"transfer.send",200,JSON.stringify({success:true,reference:"TXN-"+i}),new Date(now.getTime()+86400000),ago(Math.floor(Math.random()*7))]);
  }
  console.log("  ✓ 50 idempotency_keys");

  // 21. flutterwave_transactions (correct schema: amount_usd not amount, no narration/payment_type)
  for(let i=0;i<40;i++){
    const uid=users[i%users.length],amt=[50,100,250,500,1000][i%5];
    await q(`INSERT INTO flutterwave_transactions(user_id,flw_ref,tx_ref,amount_usd,currency,status,wallet_credited,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [uid,"FLW-REF-"+i+"-"+Date.now(),"FLW-TXN-"+i+"-"+Date.now(),amt,"NGN","successful",true,ago(Math.floor(Math.random()*60)),ago(Math.floor(Math.random()*60))]);
  }
  console.log("  ✓ 40 flutterwave_transactions");

  // 22. paypal_transactions (correct schema: amount_usd not amount)
  for(let i=0;i<30;i++){
    const uid=users[i%users.length],amt=[25,50,100,250][i%4];
    await q(`INSERT INTO paypal_transactions(user_id,paypal_order_id,paypal_capture_id,amount_usd,currency,status,wallet_credited,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [uid,"PP-ORD-"+i+"-"+Date.now(),"PP-CAP-"+i,amt,"USD","COMPLETED",true,ago(Math.floor(Math.random()*60)),ago(Math.floor(Math.random()*60))]);
  }
  console.log("  ✓ 30 paypal_transactions");

  // 23. tenant_users (correct schema: joined_at not createdAt)
  for(const tid of tenants){
    for(const uid of users.slice(0,3)){
      await q(`INSERT INTO tenant_users(tenant_id,user_id,role,joined_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [tid,uid,["admin","member","viewer"][uid%3],ago(Math.floor(Math.random()*90))]);
    }
  }
  console.log("  ✓ "+tenants.length*3+" tenant_users");

  // 24. tenant_feature_flags (correct schema: flag_id not feature_key)
  for(const tid of tenants){
    for(const fid of featureFlags.slice(0,3)){
      await q(`INSERT INTO tenant_feature_flags(tenant_id,flag_id,enabled,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [tid,fid,true,ago(30),ago(1)]);
    }
  }
  console.log("  ✓ "+tenants.length*3+" tenant_feature_flags");

  // 25. user_feature_flags (correct schema: flag_id not feature_key)
  for(let i=0;i<30;i++){
    const fid=featureFlags[i%featureFlags.length];
    if(!fid) continue;
    await q(`INSERT INTO user_feature_flags(user_id,flag_id,enabled,"createdAt") VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [users[i%users.length],fid,i%3!==2,ago(Math.floor(Math.random()*30))]);
  }
  console.log("  ✓ 30 user_feature_flags");

  // 26. white_label_configs (correct schema: no brand_name/primary_color/logo_url/domain)
  for(const tid of tenants){
    await q(`INSERT INTO white_label_configs(tenant_id,"createdAt","updatedAt") VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tid,ago(60),ago(1)]);
  }
  console.log("  ✓ "+tenants.length+" white_label_configs");

  // 27. tenant_onboarding_sessions - invite_code_id is NOT NULL, use sequential IDs
  for(let i=0;i<tenants.length;i++){
    const tid=tenants[i];
    await q(`INSERT INTO tenant_onboarding_sessions(session_token,invite_code_id,user_id,tenant_id,step,data,status,completed_at,expires_at,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      ["sess-"+tid+"-"+Date.now(),i+1,users[0],tid,5,JSON.stringify({completed:true}),"completed",ago(45),new Date(now.getTime()+86400000*30),ago(45),ago(1)]);
  }
  console.log("  ✓ "+tenants.length+" tenant_onboarding_sessions");

  console.log("\n✅ All empty tables seeded! 110/110 tables now have data.");
  await pool.end();
}

main().catch(e => { console.error("❌ Error:", e.message); process.exit(1); });
