//! 能力覆盖层 · 重启恢复 —— 同一份 `~/.zhuye`,两个进程。
//!
//! 夹具是「一进程一 app」;而桌面的真实生命周期是「退出 → 再启动」。
//! 这里用**子进程重执行**复刻:父进程起一个子进程(`current_exe` +
//! `--exact` 只跑本用例,`REFLECT_RESTART_PHASE=1` 进入阶段一),阶段一
//! 在共享 HOME 里写入各类持久化状态后退出;父进程再以**同一份 HOME**构建
//! 全新 app(阶段二),逐项断言读回。
//!
//! 覆盖的持久化面:配置 / 记忆 / 审批白名单 / agent 定义 / squad /
//! 任务列表 / 定时任务 / 工作区历史。
//!
//! 本文件**只有一个用例**是有意的:父进程在首次 `harness()` 前就要设置
//! `REFLECT_TEST_HOME`,不能让同进程其它用例先以默认基目录初始化夹具。

mod common;

use serde_json::{Value, json};

const PHASE_ENV: &str = "REFLECT_RESTART_PHASE";
const HOME_ENV: &str = "REFLECT_TEST_HOME";
const TEST_NAME: &str = "persistent_state_survives_a_process_restart";

fn invoke_ok(cmd: &str, body: Value) -> Value {
    common::invoke_ok(cmd, body)
}

/// 阶段一(子进程):写入各类持久化状态。
fn phase_one_mutations() {
    drop(common::harness());

    // 配置:真后端会重新序列化,值(而非注释)才能读回。
    invoke_ok(
        "reflect_save_config",
        json!({ "toml": "[hooks]\nenabled = []\n\n[sandbox]\nwritable_dirs = [\"/tmp/restart-recovery-marker\"]\n" }),
    );
    // 记忆。
    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": "user", "key": "restart-recovery-key", "value": "pnpm test after restart" }),
    );
    // 审批白名单。
    invoke_ok(
        "reflect_save_allowlist",
        json!({ "list": { "prefixes": ["git restart-probe"] } }),
    );
    // agent 定义。
    invoke_ok(
        "reflect_save_agent_def",
        json!({ "def": { "name": "restart-recovery-agent", "description": "重启恢复探针", "prompt": "你是探针。" } }),
    );
    // squad。
    invoke_ok(
        "reflect_create_squad",
        json!({ "spec": {
            "name": "restart-recovery-squad",
            "description": "重启恢复 squad",
            "leaderActor": { "actorType": "agent", "actorId": "team-lead@restart-recovery-squad", "kind": "lead" },
            "members": [],
            "createdAtMs": 1_700_000_000_u64,
        } }),
    );
    // 任务。
    invoke_ok(
        "reflect_create_task",
        json!({ "list": "restart-recovery-list", "subject": "restart recovery task subject", "description": "阶段一创建" }),
    );
    // 定时任务:上游 scheduler 支持原子落盘,重启后应恢复同一 job id。
    invoke_ok(
        "reflect_add_schedule",
        json!({ "schedule": "0 3 * * *", "prompt": "restart recovery schedule", "name": "restart-schedule" }),
    );
    // 工作区历史:指向共享基目录下的 workspace(夹具已创建)。
    let home = std::env::var(HOME_ENV).expect("子进程应有共享 HOME");
    invoke_ok(
        "reflect_set_workspace",
        json!({ "path": format!("{home}/workspace") }),
    );
}

/// 阶段二(父进程):全新 app、同一份 HOME,逐项读回。
fn phase_two_assertions() {
    drop(common::harness());

    let config = invoke_ok("reflect_get_config", json!({}));
    assert!(
        config
            .as_str()
            .unwrap_or_default()
            .contains("restart-recovery-marker"),
        "配置未在重启后读回: {config}"
    );

    let memory = invoke_ok("reflect_list_memory", json!({}));
    assert!(
        memory.to_string().contains("restart-recovery-key"),
        "记忆未在重启后读回: {memory}"
    );

    let allowlist = invoke_ok("reflect_load_allowlist", json!({}));
    assert!(
        allowlist.to_string().contains("git restart-probe"),
        "审批白名单未在重启后读回: {allowlist}"
    );
    let hit = invoke_ok(
        "reflect_check_allowlist",
        json!({ "prefix": "git restart-probe --short" }),
    );
    assert_eq!(hit, json!(true), "白名单前缀匹配未恢复: {hit}");

    let def = invoke_ok(
        "reflect_get_agent_def",
        json!({ "name": "restart-recovery-agent" }),
    );
    assert_eq!(
        def["name"],
        json!("restart-recovery-agent"),
        "agent 定义未读回: {def}"
    );

    let squad = invoke_ok(
        "reflect_get_squad",
        json!({ "name": "restart-recovery-squad" }),
    );
    assert_eq!(
        squad["name"],
        json!("restart-recovery-squad"),
        "squad 未读回: {squad}"
    );

    let tasks = invoke_ok(
        "reflect_list_tasks",
        json!({ "list": "restart-recovery-list" }),
    );
    assert!(
        tasks.to_string().contains("restart recovery task subject"),
        "任务未在重启后读回: {tasks}"
    );

    let schedules = invoke_ok("reflect_list_schedules", json!({}));
    assert!(
        schedules
            .as_array()
            .is_some_and(|jobs| jobs.iter().any(|job| {
                job["prompt"] == "restart recovery schedule" && job["name"] == "restart-schedule"
            })),
        "定时任务未在重启后读回: {schedules}"
    );

    let ws = invoke_ok("reflect_current_workspace", json!({}));
    assert!(
        ws.as_str().unwrap_or_default().contains("workspace"),
        "工作区未在重启后读回: {ws}"
    );
}

#[test]
fn persistent_state_survives_a_process_restart() {
    if std::env::var(PHASE_ENV).as_deref() == Ok("1") {
        phase_one_mutations();
        return;
    }

    // 父进程:共享基目录 → 起子进程跑阶段一 → 自己以同一 HOME 跑阶段二。
    let shared =
        std::env::temp_dir().join(format!("reflect-desktop-restart-{}", std::process::id()));
    std::fs::create_dir_all(&shared).expect("create shared restart home base");

    let exe = std::env::current_exe().expect("locate test binary");
    let status = std::process::Command::new(exe)
        .arg("--exact")
        .arg(TEST_NAME)
        .arg("--nocapture")
        .env(PHASE_ENV, "1")
        .env(HOME_ENV, &shared)
        .status()
        .expect("spawn phase-one child");
    assert!(
        status.success(),
        "阶段一(子进程)失败: {status:?} —— 共享目录 {shared:?}"
    );

    // 父进程切到同一基目录(必须发生在本进程首次 harness() 之前)。
    // SAFETY: 本二进制只有这一个用例;此刻没有并发读写环境变量的线程。
    unsafe {
        std::env::set_var(HOME_ENV, &shared);
    }
    phase_two_assertions();
}
