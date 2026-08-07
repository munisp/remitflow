FROM postgres:16.4-alpine

RUN apk add --no-cache aws-cli bash coreutils jq openssl
COPY backup.sh /usr/local/bin/remitflow-backup
COPY restore-drill.sh /usr/local/bin/remitflow-restore-drill
RUN chmod 0550 /usr/local/bin/remitflow-backup /usr/local/bin/remitflow-restore-drill

USER postgres
ENTRYPOINT ["/usr/local/bin/remitflow-backup"]
