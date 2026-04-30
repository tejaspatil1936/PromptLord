#!/usr/bin/env python3
"""
Flexible Git Commit Date Rewriter
Re-creates commits with new dates based on patterns or date ranges.
"""

import subprocess
import random
import sys
import os
import argparse
from datetime import datetime, timedelta

def run_command(cmd, cwd=None, env=None):
    """Executes a shell command and returns stdout, stderr, and exit code."""
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, 
        encoding='utf-8', errors='ignore', cwd=cwd, env=env
    )
    return result.stdout.strip(), result.stderr.strip(), result.returncode

def parse_args():
    """Parses CLI arguments with interactive fallback."""
    parser = argparse.ArgumentParser(description="Flexible Git Commit Date Rewriter")
    parser.add_argument("--start-date", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", help="End date (YYYY-MM-DD)")
    parser.add_argument("--pattern", help="Comma-separated integers (e.g., 3,4,5)")
    parser.add_argument("--start-commit", type=int, default=1, help="1-indexed oldest commit to start from")
    parser.add_argument("--end-commit", type=int, help="1-indexed oldest commit to end at")
    parser.add_argument("--skip-weekends", action="store_true", help="Skip Saturdays and Sundays")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    
    args = parser.parse_args()

    if not args.start_date:
        args.start_date = input("Enter start date (YYYY-MM-DD): ").strip()
    
    # Validation for start_date
    try:
        datetime.strptime(args.start_date, "%Y-%m-%d")
    except ValueError:
        print(f"Error: Invalid start-date format: {args.start_date}")
        sys.exit(1)

    if args.end_date:
        try:
            datetime.strptime(args.end_date, "%Y-%m-%d")
        except ValueError:
            print(f"Error: Invalid end-date format: {args.end_date}")
            sys.exit(1)
        
        if args.end_date < args.start_date:
            print(f"Error: end-date {args.end_date} is before start-date {args.start_date}")
            sys.exit(1)

    if args.pattern:
        try:
            args.pattern_list = [int(p.strip()) for p in args.pattern.split(',')]
        except ValueError:
            print(f"Error: Pattern must be comma-separated integers (e.g., 3,4,5)")
            sys.exit(1)
    else:
        args.pattern_list = None

    return args

def collect_commits():
    """Gathers commit information from the repository."""
    _, _, code = run_command("git rev-parse --git-dir")
    if code != 0:
        print("Error: Not a git repository")
        sys.exit(1)

    commits_raw, err, code = run_command('git log --format="%H|||%an|||%ae|||%ad|||%s" --date=iso')
    if code != 0:
        print(f"Error reading commits: {err}")
        sys.exit(1)
    
    if not commits_raw:
        print("Error: No commits found")
        sys.exit(1)

    commits = []
    for line in commits_raw.split('\n'):
        if '|||' in line:
            parts = line.split('|||')
            if len(parts) >= 5:
                commits.append({
                    'hash': parts[0],
                    'author': parts[1],
                    'email': parts[2],
                    'date': parts[3],
                    'message': '|||'.join(parts[4:])
                })
    
    # Reverse to get oldest first
    commits.reverse()
    return commits

def compute_distribution(args, num_commits):
    """Computes how many commits go to each day based on rules."""
    start_dt = datetime.strptime(args.start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(args.end_date, "%Y-%m-%d") if args.end_date else None
    
    distribution = []
    current_dt = start_dt
    commits_assigned = 0

    # Rule 3: Start + End date + Pattern
    if end_dt and args.pattern_list:
        pattern_idx = 0
        while current_dt <= end_dt and commits_assigned < num_commits:
            if args.skip_weekends and current_dt.weekday() >= 5:
                current_dt += timedelta(days=1)
                continue
            
            count = args.pattern_list[pattern_idx % len(args.pattern_list)]
            count = min(count, num_commits - commits_assigned)
            
            distribution.append((current_dt.strftime("%Y-%m-%d"), current_dt.strftime("%a"), count))
            commits_assigned += count
            pattern_idx += 1
            current_dt += timedelta(days=1)
        
        if commits_assigned < num_commits:
            print(f"Error: Pattern provides {commits_assigned} slots but you have {num_commits} commits to rewrite.")
            sys.exit(1)

    # Rule 2: Start + End date, no pattern
    elif end_dt:
        days = []
        temp_dt = start_dt
        while temp_dt <= end_dt:
            if not (args.skip_weekends and temp_dt.weekday() >= 5):
                days.append(temp_dt)
            temp_dt += timedelta(days=1)
        
        if not days:
            print("Error: No valid days in the range (maybe all are weekends?)")
            sys.exit(1)
        
        if len(days) > num_commits:
            print(f"Error: Range has {len(days)} days but only {num_commits} commits. Every day needs at least 1 commit.")
            sys.exit(1)

        base_count = num_commits // len(days)
        remainder = num_commits % len(days)
        
        day_counts = [base_count] * len(days)
        if remainder > 0:
            extra_indices = random.sample(range(len(days)), remainder)
            for idx in extra_indices:
                day_counts[idx] += 1
        
        for dt, count in zip(days, day_counts):
            distribution.append((dt.strftime("%Y-%m-%d"), dt.strftime("%a"), count))
        commits_assigned = num_commits

    # Rule 1: Pattern given, no end date
    elif args.pattern_list:
        pattern_idx = 0
        while commits_assigned < num_commits:
            if args.skip_weekends and current_dt.weekday() >= 5:
                current_dt += timedelta(days=1)
                continue
            
            count = args.pattern_list[pattern_idx % len(args.pattern_list)]
            count = min(count, num_commits - commits_assigned)
            
            distribution.append((current_dt.strftime("%Y-%m-%d"), current_dt.strftime("%a"), count))
            commits_assigned += count
            pattern_idx += 1
            current_dt += timedelta(days=1)

    # Rule 4: Only start date
    else:
        while commits_assigned < num_commits:
            if args.skip_weekends and current_dt.weekday() >= 5:
                current_dt += timedelta(days=1)
                continue
            
            count = random.randint(1, 6)
            count = min(count, num_commits - commits_assigned)
            
            distribution.append((current_dt.strftime("%Y-%m-%d"), current_dt.strftime("%a"), count))
            commits_assigned += count
            current_dt += timedelta(days=1)

    return distribution

def assign_times(distribution):
    """Assigns random, increasing times for each day's commits."""
    final_dates = []
    for date_str, _, count in distribution:
        times = []
        for _ in range(count):
            h = random.randint(9, 20)
            m = random.randint(0, 59)
            s = random.randint(0, 59)
            times.append(f"{h:02d}:{m:02d}:{s:02d}")
        
        times.sort()
        for t in times:
            final_dates.append(f"{date_str} {t}")
    return final_dates

def print_distribution_table(distribution):
    print(f"{'Date':<12} | {'Day':<3} | {'Commits':<7}")
    print("-" * 28)
    for date, day, count in distribution:
        print(f"{date:<12} | {day:<3} | {count:<7}")
    print()

def print_dry_run(commits, start_idx, end_idx, new_dates):
    print(f"{'Index':<5} | {'Hash':<8} | {'Original Date':<19} | {'New Date':<19} | {'Message'}")
    print("-" * 80)
    
    date_idx = 0
    for i, commit in enumerate(commits):
        idx = i + 1
        orig_date = commit['date'][:19]
        if start_idx <= idx <= end_idx:
            new_date = new_dates[date_idx]
            date_idx += 1
            status = "REWRITE"
        else:
            new_date = orig_date
            status = "KEEP   "
        
        msg = commit['message'][:30] + "..." if len(commit['message']) > 30 else commit['message']
        print(f"{idx:<5} | {commit['hash'][:8]} | {orig_date:<19} | {new_date:<19} | {msg}")
    
    print(f"\nSummary:")
    print(f"  Total commits to rewrite: {len(new_dates)}")
    print(f"  Date range used: {new_dates[0].split()[0]} to {new_dates[-1].split()[0]}")

def rewrite_history(commits, start_idx, end_idx, new_dates, current_branch):
    backup = f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    print(f"Creating backup: {backup}")
    run_command(f"git branch {backup}")
    
    temp_branch = f"temp-rewrite-{datetime.now().strftime('%H%M%S')}"
    run_command(f"git checkout --orphan {temp_branch}")
    
    date_idx = 0
    for i, commit_info in enumerate(commits):
        idx = i + 1
        if start_idx <= idx <= end_idx:
            new_date = new_dates[date_idx]
            date_idx += 1
        else:
            new_date = commit_info['date']
        
        print(f"[{idx}/{len(commits)}] {commit_info['hash'][:8]} -> {new_date}")
        
        run_command(f"git checkout {commit_info['hash']} -- .")
        run_command("git add -A")
        
        env = os.environ.copy()
        env['GIT_AUTHOR_NAME'] = commit_info['author']
        env['GIT_AUTHOR_EMAIL'] = commit_info['email']
        env['GIT_AUTHOR_DATE'] = new_date
        env['GIT_COMMITTER_NAME'] = commit_info['author']
        env['GIT_COMMITTER_EMAIL'] = commit_info['email']
        env['GIT_COMMITTER_DATE'] = new_date
        
        # Original message preservation logic
        message = commit_info['message'].replace('"', '\\"')
        commit_cmd = f'git commit -m "{message}" --allow-empty'
        subprocess.run(commit_cmd, shell=True, env=env, capture_output=True)
    
    print(f"\nFinalizing rewrite...")
    run_command(f"git branch -f {current_branch} {temp_branch}")
    run_command(f"git checkout {current_branch}")
    run_command(f"git branch -D {temp_branch}")
    
    print("\nNew commit dates (last 20):")
    output, _, _ = run_command('git log --pretty=format:"%h %ad %s" --date=short -20')
    print(output)
    
    print(f"\n=== Success! ===")
    print(f"Backup: {backup}")
    print(f"To push: git push --force origin {current_branch}")
    print(f"To restore: git reset --hard {backup}\n")

def main():
    args = parse_args()
    commits = collect_commits()
    total_commits = len(commits)
    
    if args.end_commit is None:
        args.end_commit = total_commits
    
    if not (1 <= args.start_commit <= total_commits):
        print(f"Error: --start-commit {args.start_commit} out of bounds (1-{total_commits})")
        sys.exit(1)
    if not (1 <= args.end_commit <= total_commits):
        print(f"Error: --end-commit {args.end_commit} out of bounds (1-{total_commits})")
        sys.exit(1)
    if args.start_commit > args.end_commit:
        print(f"Error: --start-commit is greater than --end-commit")
        sys.exit(1)

    num_to_rewrite = args.end_commit - args.start_commit + 1
    distribution = compute_distribution(args, num_to_rewrite)
    new_dates = assign_times(distribution)
    
    if args.dry_run:
        print_distribution_table(distribution)
        print_dry_run(commits, args.start_commit, args.end_commit, new_dates)
        return

    print_distribution_table(distribution)
    confirm = input(f"Rewrite {num_to_rewrite} commits? (yes/no): ")
    if confirm.lower() != "yes":
        print("Aborted")
        sys.exit(0)
    
    current_branch, _, _ = run_command("git rev-parse --abbrev-ref HEAD")
    rewrite_history(commits, args.start_commit, args.end_commit, new_dates, current_branch)

if __name__ == "__main__":
    main()
