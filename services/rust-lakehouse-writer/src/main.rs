//! RemitFlow Wave-10 C6 — rust-lakehouse-writer
//!
//! Fluvio consumer-group reader for the bronze medallion layer:
//!   topics: `ledger-events-bronze`, `bill-capture-extracted`
//!   sink:   {LAKE_DIR}/bronze/<topic>/dt=YYYY-MM-DD/part-<unixts>-<seq>.parquet
//!
//! Failure discipline (fail closed):
//!   - FLUVIO_ENDPOINT unset  -> exit(1) with a clear error
//!   - LAKE_DIR unset         -> exit(1) with a clear error
//!   - malformed JSON records are NOT dropped silently: they are written to a
//!     `_raw_json`-only row so bronze never loses bytes.
//!   - graceful shutdown (SIGTERM/SIGINT) flushes all pending batches.
//!
//! Metrics: tiny hyper-free std TCP listener on METRICS_PORT (default 9115):
//!   GET /metrics  -> Prometheus text exposition
//!   GET /health   -> {"status":"ok"}
//!
//! R1: no Rust toolchain in the authoring environment — this file is
//! structurally reviewed by hand; `cargo build` is a residual check.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write as _;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use arrow2::array::{Array, MutableArray, MutableBooleanArray, MutablePrimitiveArray, MutableUtf8Array};
use arrow2::chunk::Chunk;
use arrow2::datatypes::{transverse, DataType, Field, Schema};
use arrow2::io::parquet::write::{
    CompressionOptions, EncodingMap, FileWriter, RowGroupIterator, Version, WriteOptions,
};
use chrono::{DateTime, Utc};
use fluvio::config::FluvioConfig;
use fluvio::consumer::ConsumerConfigExtBuilder;
use fluvio::{Fluvio, Offset};
use futures_util::StreamExt;
use serde_json::Value;
use tracing::{error, info, warn};

/// Bronze topics consumed by this writer (SPEC-wave10 C6).
const TOPICS: [&str; 2] = ["ledger-events-bronze", "bill-capture-extracted"];
/// Consumer group id shared by all instances of this writer.
const CONSUMER_GROUP: &str = "lakehouse-writer";

// ─── Metrics ────────────────────────────────────────────────────────────────

struct Metrics {
    messages_consumed: AtomicU64,
    messages_malformed: AtomicU64,
    batches_flushed: AtomicU64,
    files_written: AtomicU64,
    bytes_written: AtomicU64,
    flush_errors: AtomicU64,
    per_topic: Mutex<BTreeMap<String, u64>>,
}

impl Metrics {
    fn new() -> Self {
        Self {
            messages_consumed: AtomicU64::new(0),
            messages_malformed: AtomicU64::new(0),
            batches_flushed: AtomicU64::new(0),
            files_written: AtomicU64::new(0),
            bytes_written: AtomicU64::new(0),
            flush_errors: AtomicU64::new(0),
            per_topic: Mutex::new(BTreeMap::new()),
        }
    }

    fn inc_topic(&self, topic: &str) {
        if let Ok(mut guard) = self.per_topic.lock() {
            *guard.entry(topic.to_string()).or_insert(0) += 1;
        }
    }

    fn render_prometheus(&self) -> String {
        let mut out = String::new();
        out.push_str("# HELP lakehouse_writer_messages_consumed_total Fluvio records consumed.\n");
        out.push_str("# TYPE lakehouse_writer_messages_consumed_total counter\n");
        out.push_str(&format!(
            "lakehouse_writer_messages_consumed_total {}\n",
            self.messages_consumed.load(Ordering::Relaxed)
        ));
        if let Ok(guard) = self.per_topic.lock() {
            for (topic, n) in guard.iter() {
                out.push_str(&format!(
                    "lakehouse_writer_topic_messages_total{{topic=\"{}\"}} {}\n",
                    topic, n
                ));
            }
        }
        out.push_str(&format!(
            "lakehouse_writer_messages_malformed_total {}\n",
            self.messages_malformed.load(Ordering::Relaxed)
        ));
        out.push_str(&format!(
            "lakehouse_writer_batches_flushed_total {}\n",
            self.batches_flushed.load(Ordering::Relaxed)
        ));
        out.push_str(&format!(
            "lakehouse_writer_files_written_total {}\n",
            self.files_written.load(Ordering::Relaxed)
        ));
        out.push_str(&format!(
            "lakehouse_writer_bytes_written_total {}\n",
            self.bytes_written.load(Ordering::Relaxed)
        ));
        out.push_str(&format!(
            "lakehouse_writer_flush_errors_total {}\n",
            self.flush_errors.load(Ordering::Relaxed)
        ));
        out
    }
}

/// Tiny hyper-free HTTP responder (std TcpListener) for /metrics and /health.
/// Runs on a dedicated OS thread; intentionally minimal — read request line,
/// route, respond, close.
fn serve_metrics(port: u16, metrics: Arc<Metrics>, shutdown: Arc<AtomicBool>) {
    let listener = match TcpListener::bind(("0.0.0.0", port)) {
        Ok(l) => l,
        Err(e) => {
            error!(error = %e, port, "metrics listener bind failed");
            return;
        }
    }
    // Non-blocking so the thread can observe the shutdown flag.
    if let Err(e) = listener.set_nonblocking(true) {
        error!(error = %e, "metrics listener set_nonblocking failed");
        return;
    }
    info!(port, "metrics listener ready (/metrics, /health)");
    while !shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 2048];
                use std::io::Read as _;
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");
                let (status, ctype, body) = if path == "/metrics" {
                    (
                        "200 OK",
                        "text/plain; version=0.0.4",
                        metrics.render_prometheus(),
                    )
                } else if path == "/health" {
                    (
                        "200 OK",
                        "application/json",
                        "{\"status\":\"ok\",\"service\":\"rust-lakehouse-writer\"}".to_string(),
                    )
                } else {
                    (
                        "404 Not Found",
                        "application/json",
                        "{\"error\":\"not found\"}".to_string(),
                    )
                };
                let resp = format!(
                    "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    ctype,
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                warn!(error = %e, "metrics accept error");
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
}

// ─── Schema inference / record flattening ───────────────────────────────────

/// Scalar cell value after flattening. Numbers are unified to f64 (bronze is a
/// lossless-ish landing zone; silver transforms re-type precisely).
#[derive(Clone, Debug, PartialEq)]
enum FlatVal {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
}

/// Column type lattice: Str absorbs everything (promotion on conflict).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ColType {
    Str,
    Num,
    Bool,
}

impl ColType {
    fn of(v: &FlatVal) -> Option<ColType> {
        match v {
            FlatVal::Str(_) => Some(ColType::Str),
            FlatVal::Num(_) => Some(ColType::Num),
            FlatVal::Bool(_) => Some(ColType::Bool),
            FlatVal::Null => None,
        }
    }
    /// Merge two observed types; conflict promotes to Str.
    fn merge(a: ColType, b: ColType) -> ColType {
        if a == b {
            a
        } else {
            ColType::Str
        }
    }
}

type FlatRecord = BTreeMap<String, FlatVal>;

/// Reserved metadata columns injected by the writer. User payload keys that
/// collide with these are skipped (never overwrite ingest lineage).
const RESERVED_COLS: [&str; 3] = ["_raw_json", "_offset", "_ingested_at_unix"];

/// Recursively flatten a JSON object into dotted-path scalar columns.
/// Arrays and nested nulls are serialized as JSON strings (bronze keeps the
/// raw bytes; silver transforms explode arrays deliberately).
fn flatten_json(prefix: &str, value: &Value, out: &mut FlatRecord) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                let key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{}.{}", prefix, k)
                };
                flatten_json(&key, v, out);
            }
        }
        Value::Bool(b) => {
            out.insert(prefix.to_string(), FlatVal::Bool(*b));
        }
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                out.insert(prefix.to_string(), FlatVal::Num(f));
            } else {
                out.insert(prefix.to_string(), FlatVal::Str(n.to_string()));
            }
        }
        Value::String(s) => {
            out.insert(prefix.to_string(), FlatVal::Str(s.clone()));
        }
        Value::Null => {
            out.insert(prefix.to_string(), FlatVal::Null);
        }
        Value::Array(_) => {
            out.insert(prefix.to_string(), FlatVal::Str(value.to_string()));
        }
    }
}

/// Flatten one raw record payload. Non-object top-level JSON is wrapped under
/// a `value` column; unparseable payloads yield an empty map (the `_raw_json`
/// column still preserves the bytes — bronze never loses data).
fn flatten_record(raw: &[u8]) -> (FlatRecord, String, bool) {
    let raw_json = String::from_utf8_lossy(raw).to_string();
    match serde_json::from_slice::<Value>(raw) {
        Ok(Value::Object(map)) => {
            let mut out = FlatRecord::new();
            for (k, v) in map {
                // Skip user keys that collide with reserved metadata columns.
                if RESERVED_COLS.contains(&k.as_str()) {
                    continue;
                }
                flatten_json(&k, &v, &mut out);
            }
            (out, raw_json, true)
        }
        Ok(other) => {
            let mut out = FlatRecord::new();
            out.insert("value".to_string(), FlatVal::Str(other.to_string()));
            (out, raw_json, true)
        }
        Err(_) => (FlatRecord::new(), raw_json, false),
    }
}

/// Infer the column set across a batch: union of flattened keys with type
/// promotion (conflict -> Str). Reserved metadata columns are always present.
fn infer_schema(batch: &[FlatRecord]) -> Vec<(String, ColType)> {
    let mut cols: BTreeMap<String, ColType> = BTreeMap::new();
    for rec in batch {
        for (k, v) in rec {
            if let Some(t) = ColType::of(v) {
                cols.entry(k.clone())
                    .and_modify(|cur| *cur = ColType::merge(*cur, t))
                    .or_insert(t);
            }
        }
    }
    let mut out: Vec<(String, ColType)> = cols.into_iter().collect();
    out.push(("_raw_json".to_string(), ColType::Str));
    out.push(("_offset".to_string(), ColType::Num));
    out.push(("_ingested_at_unix".to_string(), ColType::Num));
    out
}

// ─── Parquet writing ────────────────────────────────────────────────────────

/// Compute the hive-style partition path for a topic at a given unix time.
/// Layout: {LAKE_DIR}/bronze/<topic>/dt=YYYY-MM-DD/part-<unixts>-<seq>.parquet
fn partition_path(lake_dir: &str, topic: &str, unix_ts: i64, seq: u64) -> PathBuf {
    let dt = DateTime::<Utc>::from_timestamp(unix_ts, 0)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "1970-01-01".to_string());
    PathBuf::from(lake_dir)
        .join("bronze")
        .join(topic)
        .join(format!("dt={}", dt))
        .join(format!("part-{}-{:06}.parquet", unix_ts, seq))
}

/// Build an arrow2 chunk from the batch given the inferred schema.
fn build_chunk(
    schema_cols: &[(String, ColType)],
    batch: &[FlatRecord],
    raws: &[String],
    offsets: &[i64],
    ingested: &[i64],
) -> Result<(Schema, Chunk<Box<dyn Array>>)> {
    let mut fields: Vec<Field> = Vec::with_capacity(schema_cols.len());
    let mut arrays: Vec<Box<dyn Array>> = Vec::with_capacity(schema_cols.len());

    for (name, ty) in schema_cols {
        match name.as_str() {
            "_raw_json" => {
                fields.push(Field::new(name, DataType::Utf8, true));
                let mut arr = MutableUtf8Array::<i32>::new();
                for r in raws {
                    arr.push(Some(r.as_str()));
                }
                arrays.push(arr.as_box());
            }
            "_offset" => {
                fields.push(Field::new(name, DataType::Float64, true));
                let mut arr = MutablePrimitiveArray::<f64>::new();
                for o in offsets {
                    arr.push(Some(*o as f64));
                }
                arrays.push(arr.as_box());
            }
            "_ingested_at_unix" => {
                fields.push(Field::new(name, DataType::Float64, true));
                let mut arr = MutablePrimitiveArray::<f64>::new();
                for t in ingested {
                    arr.push(Some(*t as f64));
                }
                arrays.push(arr.as_box());
            }
            _ => match ty {
                ColType::Str => {
                    fields.push(Field::new(name, DataType::Utf8, true));
                    let mut arr = MutableUtf8Array::<i32>::new();
                    for rec in batch {
                        // Missing key or explicit Null stays null; on type
                        // promotion (conflict -> Str) scalars are serialized.
                        let cell: Option<String> = match rec.get(name) {
                            Some(FlatVal::Str(s)) => Some(s.clone()),
                            Some(FlatVal::Num(n)) => Some(n.to_string()),
                            Some(FlatVal::Bool(b)) => Some(b.to_string()),
                            _ => None,
                        };
                        arr.push(cell.as_deref());
                    }
                    arrays.push(arr.as_box());
                }
                ColType::Num => {
                    fields.push(Field::new(name, DataType::Float64, true));
                    let mut arr = MutablePrimitiveArray::<f64>::new();
                    for rec in batch {
                        let cell = match rec.get(name) {
                            Some(FlatVal::Num(n)) => Some(*n),
                            _ => None,
                        };
                        arr.push(cell);
                    }
                    arrays.push(arr.as_box());
                }
                ColType::Bool => {
                    fields.push(Field::new(name, DataType::Boolean, true));
                    let mut arr = MutableBooleanArray::new();
                    for rec in batch {
                        let cell = match rec.get(name) {
                            Some(FlatVal::Bool(b)) => Some(*b),
                            _ => None,
                        };
                        arr.push(cell);
                    }
                    arrays.push(arr.as_box());
                }
            },
        }
    }
    Ok((Schema::from(fields), Chunk::new(arrays)))
}

/// Write one batch to a snappy-compressed Parquet file. Returns bytes written.
fn write_parquet_file(path: &PathBuf, schema: Schema, chunk: Chunk<Box<dyn Array>>) -> Result<u64> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create partition dir {}", parent.display()))?;
    }
    let options = WriteOptions {
        write_statistics: true,
        compression: CompressionOptions::Snappy,
        version: Version::V2,
        data_pagesize_limit: None,
    };
    let encodings = schema
        .fields
        .iter()
        .map(|f| transverse(&f.data_type, |_| EncodingMap::Plain))
        .collect::<Vec<_>>();
    let row_groups = RowGroupIterator::try_new(vec![Ok(chunk)].into_iter(), &schema, options, encodings)
        .map_err(|e| anyhow!("row group iterator: {e}"))?;
    let file = fs::File::create(path)
        .with_context(|| format!("create parquet file {}", path.display()))?;
    let mut writer = FileWriter::try_new(file, schema, options)
        .map_err(|e| anyhow!("parquet writer: {e}"))?;
    for group in row_groups {
        let group = group.map_err(|e| anyhow!("row group: {e}"))?;
        writer.write(&group).map_err(|e| anyhow!("write group: {e}"))?;
    }
    writer.end(None).map_err(|e| anyhow!("finalize parquet: {e}"))?;
    Ok(fs::metadata(path).map(|m| m.len()).unwrap_or(0))
}

// ─── Batching / consumption loop ────────────────────────────────────────────

/// Pending records for one topic, flushed on size or age threshold.
struct TopicBatch {
    topic: &'static str,
    records: Vec<FlatRecord>,
    raws: Vec<String>,
    offsets: Vec<i64>,
    ingested: Vec<i64>,
    first_record_at: Option<Instant>,
    seq: u64,
}

impl TopicBatch {
    fn new(topic: &'static str) -> Self {
        Self {
            topic,
            records: Vec::new(),
            raws: Vec::new(),
            offsets: Vec::new(),
            ingested: Vec::new(),
            first_record_at: None,
            seq: 0,
        }
    }

    fn push(&mut self, rec: FlatRecord, raw: String, offset: i64, ingested_at: i64) {
        if self.first_record_at.is_none() {
            self.first_record_at = Some(Instant::now());
        }
        self.records.push(rec);
        self.raws.push(raw);
        self.offsets.push(offset);
        self.ingested.push(ingested_at);
    }

    fn len(&self) -> usize {
        self.records.len()
    }

    fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Flush policy: every FLUSH_MAX_MESSAGES records or FLUSH_MAX_SECS of age.
    fn due(&self, max_msgs: usize, max_age: Duration) -> bool {
        if self.is_empty() {
            return false;
        }
        if self.len() >= max_msgs {
            return true;
        }
        self.first_record_at
            .map(|t| t.elapsed() >= max_age)
            .unwrap_or(false)
    }

    /// Flush to a partitioned Parquet file. On failure the batch is RETAINED
    /// (returned Err) so the caller can retry — bronze must not drop data.
    fn flush(&mut self, lake_dir: &str, metrics: &Metrics) -> Result<()> {
        if self.is_empty() {
            return Ok(());
        }
        let unix_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        self.seq += 1;
        let path = partition_path(lake_dir, self.topic, unix_ts, self.seq);
        let schema_cols = infer_schema(&self.records);
        let (schema, chunk) = build_chunk(&schema_cols, &self.records, &self.raws, &self.offsets, &self.ingested)?;
        let bytes = write_parquet_file(&path, schema, chunk)?;
        info!(
            topic = self.topic,
            records = self.records.len(),
            bytes,
            path = %path.display(),
            "bronze batch flushed"
        );
        metrics.batches_flushed.fetch_add(1, Ordering::Relaxed);
        metrics.files_written.fetch_add(1, Ordering::Relaxed);
        metrics.bytes_written.fetch_add(bytes, Ordering::Relaxed);
        self.records.clear();
        self.raws.clear();
        self.offsets.clear();
        self.ingested.clear();
        self.first_record_at = None;
        Ok(())
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Connect to Fluvio with bounded exponential backoff. Config errors fail
/// closed before this; transient broker unavailability retries.
async fn connect_fluvio(endpoint: &str) -> Result<Fluvio> {
    let mut delay = Duration::from_secs(1);
    let max_delay = Duration::from_secs(60);
    loop {
        let config = FluvioConfig::new(endpoint);
        match Fluvio::connect_with_config(&config).await {
            Ok(client) => {
                info!(endpoint, "connected to fluvio");
                return Ok(client);
            }
            Err(e) => {
                warn!(error = %e, endpoint, backoff_secs = delay.as_secs(), "fluvio connect failed, retrying");
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(max_delay);
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // ── Fail closed on missing configuration ────────────────────────────────
    let endpoint = match env::var("FLUVIO_ENDPOINT") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            eprintln!("FATAL: FLUVIO_ENDPOINT is required (e.g. fluvio-sc:9003); refusing to start unconfigured");
            process::exit(1);
        }
    };
    let lake_dir = match env::var("LAKE_DIR") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            eprintln!("FATAL: LAKE_DIR is required (bronze parquet root, e.g. /data/lakehouse); refusing to start unconfigured");
            process::exit(1);
        }
    };
    let metrics_port: u16 = env::var("METRICS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9115);
    let flush_max_msgs: usize = env::var("FLUSH_MAX_MESSAGES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(500);
    let flush_max_secs: u64 = env::var("FLUSH_MAX_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);

    let metrics = Arc::new(Metrics::new());
    let shutdown = Arc::new(AtomicBool::new(false));

    // Metrics/health listener (std TCP, hyper-free per spec).
    {
        let m = Arc::clone(&metrics);
        let s = Arc::clone(&shutdown);
        std::thread::spawn(move || serve_metrics(metrics_port, m, s));
    }

    let fluvio = connect_fluvio(&endpoint).await?;

    // One consumer per topic, all in the same consumer group so multiple
    // writer instances share offsets/coordination.
    let mut streams = Vec::with_capacity(TOPICS.len());
    for topic in TOPICS {
        let cfg = ConsumerConfigExtBuilder::default()
            .topic(topic.to_string())
            .consumer_group(CONSUMER_GROUP.to_string())
            .build()
            .with_context(|| format!("consumer config for topic {topic}"))?;
        let consumer = fluvio
            .consumer_with_config(cfg)
            .await
            .with_context(|| format!("consumer for topic {topic}"))?;
        let stream = consumer
            .stream(Offset::beginning())
            .await
            .with_context(|| format!("stream for topic {topic}"))?;
        streams.push(Box::pin(stream));
        info!(topic, group = CONSUMER_GROUP, "subscribed");
    }
    // Destructure into independent stream bindings: select! polls both
    // concurrently, which requires separate mutable borrows (indexing one Vec
    // from two select! branches would be a double &mut borrow).
    let mut stream_iter = streams.into_iter();
    let mut stream0 = stream_iter.next().expect("two topic streams");
    let mut stream1 = stream_iter.next().expect("two topic streams");

    let mut batches: Vec<TopicBatch> = TOPICS.iter().map(|t| TopicBatch::new(*t)).collect();
    let flush_max_age = Duration::from_secs(flush_max_secs);

    // Graceful shutdown on SIGTERM or SIGINT (ctrl_c covers SIGINT).
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .context("install SIGTERM handler")?;
    let mut tick = tokio::time::interval(Duration::from_secs(1));

    info!(
        flush_max_msgs,
        flush_max_secs, "lakehouse writer running"
    );

    // A None from a stream means it ended; guard branches so a terminated
    // stream cannot busy-spin the select loop.
    let mut stream0_active = true;
    let mut stream1_active = true;

    loop {
        tokio::select! {
            biased;
            _ = sigterm.recv() => {
                info!("SIGTERM received; flushing pending batches");
                break;
            }
            _ = tokio::signal::ctrl_c() => {
                info!("SIGINT received; flushing pending batches");
                break;
            }
            _ = tick.tick() => {
                // Time-based flush check.
                for batch in batches.iter_mut() {
                    if batch.due(flush_max_msgs, flush_max_age) {
                        if let Err(e) = batch.flush(&lake_dir, &metrics) {
                            metrics.flush_errors.fetch_add(1, Ordering::Relaxed);
                            error!(error = %e, topic = batch.topic, "flush failed; batch retained for retry");
                        }
                    }
                }
            }
            msg = stream0.next(), if stream0_active => {
                if msg.is_none() {
                    stream0_active = false;
                }
                handle_record(msg, 0, &mut batches, &metrics, flush_max_msgs, &lake_dir);
            }
            msg = stream1.next(), if stream1_active => {
                if msg.is_none() {
                    stream1_active = false;
                }
                handle_record(msg, 1, &mut batches, &metrics, flush_max_msgs, &lake_dir);
            }
        }
    }

    // Final graceful-shutdown flush: retry once after a short pause, then
    // report and exit non-zero if data could not be persisted (fail loud).
    let mut pending = 0usize;
    for batch in batches.iter_mut() {
        if batch.is_empty() {
            continue;
        }
        if let Err(e) = batch.flush(&lake_dir, &metrics) {
            error!(error = %e, topic = batch.topic, "shutdown flush failed, retrying once");
            tokio::time::sleep(Duration::from_secs(2)).await;
            if let Err(e2) = batch.flush(&lake_dir, &metrics) {
                metrics.flush_errors.fetch_add(1, Ordering::Relaxed);
                error!(error = %e2, topic = batch.topic, records = batch.len(), "shutdown flush failed permanently; records NOT persisted");
                pending += batch.len();
            }
        }
    }
    shutdown.store(true, Ordering::Relaxed);
    if pending > 0 {
        eprintln!("FATAL: {pending} records could not be flushed during shutdown");
        process::exit(1);
    }
    info!("lakehouse writer stopped cleanly");
    Ok(())
}

/// Ingest one consumer-stream item into the right batch, flushing on size.
fn handle_record(
    msg: Option<Result<fluvio::consumer::Record, fluvio::error::FluvioError>>,
    idx: usize,
    batches: &mut [TopicBatch],
    metrics: &Metrics,
    flush_max_msgs: usize,
    lake_dir: &str,
) {
    let batch = &mut batches[idx];
    match msg {
        Some(Ok(record)) => {
            let raw_bytes: Vec<u8> = record.value().to_vec();
            let offset = record.offset();
            let (flat, raw_json, parsed) = flatten_record(&raw_bytes);
            if !parsed {
                metrics.messages_malformed.fetch_add(1, Ordering::Relaxed);
                warn!(topic = batch.topic, offset, "malformed JSON record; persisted via _raw_json only");
            }
            metrics.messages_consumed.fetch_add(1, Ordering::Relaxed);
            metrics.inc_topic(batch.topic);
            batch.push(flat, raw_json, offset, unix_now());
            if batch.len() >= flush_max_msgs {
                if let Err(e) = batch.flush(lake_dir, metrics) {
                    metrics.flush_errors.fetch_add(1, Ordering::Relaxed);
                    error!(error = %e, topic = batch.topic, "size-triggered flush failed; batch retained");
                }
            }
        }
        Some(Err(e)) => {
            warn!(error = %e, topic = batch.topic, "stream error; awaiting next record");
        }
        None => {
            warn!(topic = batch.topic, "stream ended unexpectedly");
        }
    }
}

// ─── Unit tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(json: &str) -> FlatRecord {
        flatten_record(json.as_bytes()).0
    }

    #[test]
    fn flatten_nested_object_uses_dotted_paths() {
        let r = rec(r#"{"a": 1, "b": {"c": "x", "d": true}}"#);
        assert_eq!(r.get("a"), Some(&FlatVal::Num(1.0)));
        assert_eq!(r.get("b.c"), Some(&FlatVal::Str("x".to_string())));
        assert_eq!(r.get("b.d"), Some(&FlatVal::Bool(true)));
    }

    #[test]
    fn flatten_arrays_become_json_strings() {
        let r = rec(r#"{"items": [1, 2, 3]}"#);
        assert_eq!(r.get("items"), Some(&FlatVal::Str("[1,2,3]".to_string())));
    }

    #[test]
    fn reserved_user_keys_are_skipped() {
        let r = rec(r#"{"_raw_json": "forged", "amount": 5}"#);
        assert!(!r.contains_key("_raw_json"));
        assert_eq!(r.get("amount"), Some(&FlatVal::Num(5.0)));
    }

    #[test]
    fn malformed_json_yields_empty_record_but_preserves_raw() {
        let (flat, raw, parsed) = flatten_record(b"{not json");
        assert!(!parsed);
        assert!(flat.is_empty());
        assert_eq!(raw, "{not json");
    }

    #[test]
    fn non_object_top_level_wraps_under_value() {
        let (flat, _, parsed) = flatten_record(b"[1,2]");
        assert!(parsed);
        assert_eq!(flat.get("value"), Some(&FlatVal::Str("[1,2]".to_string())));
    }

    #[test]
    fn schema_inference_unions_keys_and_includes_reserved() {
        let batch = vec![rec(r#"{"a": 1}"#), rec(r#"{"b": "s"}"#)];
        let cols = infer_schema(&batch);
        let names: Vec<&str> = cols.iter().map(|(n, _)| n.as_str()).collect();
        assert!(names.contains(&"a"));
        assert!(names.contains(&"b"));
        assert!(names.contains(&"_raw_json"));
        assert!(names.contains(&"_offset"));
        assert!(names.contains(&"_ingested_at_unix"));
    }

    #[test]
    fn schema_inference_promotes_type_conflicts_to_string() {
        let batch = vec![rec(r#"{"a": 1}"#), rec(r#"{"a": "text"}"#)];
        let cols = infer_schema(&batch);
        let ty = cols.iter().find(|(n, _)| n == "a").map(|(_, t)| *t);
        assert_eq!(ty, Some(ColType::Str));
    }

    #[test]
    fn schema_inference_int_and_float_stay_numeric() {
        let batch = vec![rec(r#"{"a": 1}"#), rec(r#"{"a": 1.5}"#)];
        let cols = infer_schema(&batch);
        let ty = cols.iter().find(|(n, _)| n == "a").map(|(_, t)| *t);
        assert_eq!(ty, Some(ColType::Num));
    }

    #[test]
    fn partition_path_layout_and_date() {
        // 2024-01-02T00:00:00Z == 1704153600
        let p = partition_path("/data/lakehouse", "ledger-events-bronze", 1_704_153_600, 3);
        assert_eq!(
            p.to_string_lossy(),
            "/data/lakehouse/bronze/ledger-events-bronze/dt=2024-01-02/part-1704153600-000003.parquet"
        );
    }

    #[test]
    fn batch_due_thresholds() {
        let mut b = TopicBatch::new("ledger-events-bronze");
        assert!(!b.due(500, Duration::from_secs(30)));
        b.push(FlatRecord::new(), "{}".to_string(), 0, 0);
        assert!(b.due(1, Duration::from_secs(30))); // size threshold
        let mut b2 = TopicBatch::new("ledger-events-bronze");
        b2.push(FlatRecord::new(), "{}".to_string(), 0, 0);
        assert!(b2.due(500, Duration::from_secs(0))); // age threshold
    }
}
