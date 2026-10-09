#!/bin/bash
# C/B: what each database role can see/do, straight at the LOCAL database.
# Runs as `authenticated` with the JWT sub of student A / student B / registrar / anon, the same
# way asUser() does, and prints row counts per table.
PSQL="psql -h 127.0.0.1 -p 54329 -U postgres -d lcc_tr -At -F |"
A=$($PSQL -c "select id from app.app_user where login_identifier='2020901'")
B=$($PSQL -c "select id from app.app_user where login_identifier='2024902'")
R=$($PSQL -c "select id from app.app_user where login_identifier='registrar'")
tables=$($PSQL -c "select schemaname||'.'||tablename from pg_tables where schemaname in ('app','audit') order by 1")
printf "%-38s %6s | %6s %6s %6s %6s\n" table total "anon" "stuA" "stuB" "reg"
for t in $tables; do
  tot=$($PSQL -c "select count(*) from $t")
  row="$t|$tot"
  for who in anon A B R; do
    case $who in anon) role=anon; sub="";; A) role=authenticated; sub=$A;; B) role=authenticated; sub=$B;; R) role=authenticated; sub=$R;; esac
    n=$($PSQL <<SQL 2>&1 | grep -E "^[0-9]+$|ERROR" | head -1 | cut -c1-40
begin;
select set_config('request.jwt.claim.sub','$sub',true);
set local role $role;
select count(*) from $t;
rollback;
SQL
)
    row="$row|$n"
  done
  echo "$row" | awk -F'|' '{printf "%-38s %6s | %6s %6s %6s %6s\n",$1,$2,substr($3,1,30),substr($4,1,30),substr($5,1,30),substr($6,1,30)}'
done
