//! Squad + Leader 委派 —— 多 agent 小组 + leader 委派语义层（Phase 3 条目 11）。
//!
//! Squad = 一组 agent + 一个 leader,leader 负责把任务派给成员。
//! 参考通用 squad 设计，但 ReflectDesktop 不引入
//! server/DB,直接复用 核心 crate `reflect_task::TaskManager` 的 `TeamFile` 存储
//! (`~/.zhuye/teams/<name>.json`)+ `Task.metadata.actor`(语义层 actor)。
//!
//! ## 与 核心 crate 的关系
//!
//! - **不改核心 crate**:`SquadSpec` 是 `TeamFile` 的语义包装,落 app-core。
//! - Squad name = team name(复用 [`reflect_task::team::validate_team_name`])。
//! - Squad leader = `TeamFile` 里 `agent_id == "team-lead@<name>"` 的成员。
//! - Squad task = 普通任务,`list_id = squad_name`,经 leader 认领 /
//!   owner 字段表达分配关系;actor 落 `Task.metadata.actor`。
//!
//! ## 委派模型
//!
//! 1. `create_squad` —— 把 `SquadSpec` 翻译成 `TeamFile`,`task_manager.upsert_team`。
//! 2. leader 通过 `delegate_next` 调 `task_manager.claim_next_available`
//!    原子认领一个 Pending+unblocked 任务(claim_locks 保证并发安全)。
//! 3. leader 再用 `assign_task` 把 `owner` / `metadata.actor` 改成具体成员
//!    (这步是语义层动作,不触发 核心 crate 的 claim 状态机)。

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::actor::Actor;

/// Squad 成员(语义层,对应 核心 crate `TeamMemberSpec`)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadMember {
    /// 成员 actor(含 actorId / actorType / kind)。
    pub actor: Actor,
    /// 角色(kebab-case;`"team-lead"` 或 `"architect"` / `"builder"` 等)。
    pub role: String,
    /// 模型 spec(可选;None 用默认)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 系统 prompt(可选)。
    #[serde(default)]
    pub system_prompt: String,
    /// 允许的工具白名单(空 = text-only)。
    #[serde(default)]
    pub allowed_tools: Vec<String>,
}

/// Squad 定义。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadSpec {
    /// Squad 名(= team name,合法 `[a-z0-9_-]+`,1..=64)。
    pub name: String,
    /// 描述(可选)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 领导者 actor（`kind == Lead`，`actorId == "team-lead@<name>"`）。
    pub leader_actor: Actor,
    /// 成员列表(不含 leader;leader 单独字段)。
    #[serde(default)]
    pub members: Vec<SquadMember>,
    /// 创建时间(毫秒)。
    pub created_at_ms: u64,
}

/// Squad 任务分配记录(语义层,挂 `Task.metadata`)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquadTaskAssignment {
    /// 任务 id。
    pub task_id: u32,
    /// 所属 squad 名。
    pub squad_name: String,
    /// 被分配者(可选;None = 未分配,仅 leader 认领)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<Actor>,
    /// 分配时间(毫秒)。
    pub assigned_at_ms: u64,
}

/// Squad 错误。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SquadError {
    /// 名字非法(不符合 `[a-z0-9_-]+` / 长度)。
    Invalid {
        /// 错误消息。
        message: String,
    },
    /// Squad 不存在。
    NotFound {
        /// Squad 名。
        name: String,
    },
    /// 底层 TaskManager 错误。
    TaskManager {
        /// 错误消息。
        message: String,
    },
}

impl std::fmt::Display for SquadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SquadError::Invalid { message } => write!(f, "squad invalid: {message}"),
            SquadError::NotFound { name } => write!(f, "squad not found: {name}"),
            SquadError::TaskManager { message } => write!(f, "squad task manager: {message}"),
        }
    }
}

impl std::error::Error for SquadError {}

/// 把 核心 crate `TaskError` 转成 `SquadError`。
fn tm_err(e: reflect_task::TaskError) -> SquadError {
    SquadError::TaskManager {
        message: e.to_string(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Squad 管理器:在 `TaskManager` 之上提供 leader 委派语义层。
pub struct SquadManager {
    task_manager: Arc<reflect_task::TaskManager>,
}

impl SquadManager {
    /// 用共享 `TaskManager` 构造。
    pub fn new(task_manager: Arc<reflect_task::TaskManager>) -> Self {
        Self { task_manager }
    }

    /// 共享的底层 TaskManager 句柄(供命令层直接调 task CRUD)。
    pub fn task_manager(&self) -> &Arc<reflect_task::TaskManager> {
        &self.task_manager
    }

    /// 校验 squad 名(复用 核心 crate 规则)。
    pub fn validate_name(name: &str) -> Result<(), SquadError> {
        reflect_task::team::validate_team_name(name).map_err(|e| SquadError::Invalid {
            message: e.to_string(),
        })
    }

    /// 把 `SquadSpec` 翻译成 核心 crate `TeamFile`。
    pub fn to_team_file(spec: &SquadSpec) -> reflect_task::TeamFile {
        let lead_member = reflect_task::TeamMemberSpec {
            agent_id: reflect_task::team::lead_agent_id_for(&spec.name),
            name: spec
                .leader_actor
                .display_name
                .clone()
                .unwrap_or_else(|| "team-lead".into()),
            role: "team-lead".into(),
            model: None,
            system_prompt: String::new(),
            allowed_tools: vec![],
            color: None,
            joined_at: SystemTime::UNIX_EPOCH,
            session_id: None,
            subscriptions: vec![],
        };
        let mut members = vec![lead_member];
        for m in &spec.members {
            // agent_id 用 `<role>@<name>` 形式;若 actor.actor_id 已是 `<role>@<team>`,
            // 直接复用,否则用 member.role 构造。
            let agent_id = if m.actor.actor_id.contains('@') {
                m.actor.actor_id.clone()
            } else {
                format!("{}@{}", m.role, spec.name)
            };
            members.push(reflect_task::TeamMemberSpec {
                agent_id,
                name: m
                    .actor
                    .display_name
                    .clone()
                    .unwrap_or_else(|| m.role.clone()),
                role: m.role.clone(),
                model: m.model.clone(),
                system_prompt: m.system_prompt.clone(),
                allowed_tools: m.allowed_tools.clone(),
                color: None,
                joined_at: SystemTime::UNIX_EPOCH,
                session_id: None,
                subscriptions: vec![],
            });
        }
        reflect_task::TeamFile {
            name: spec.name.clone(),
            description: spec.description.clone(),
            lead_agent_id: reflect_task::team::lead_agent_id_for(&spec.name),
            lead_session_id: None,
            members,
            created_at: SystemTime::UNIX_EPOCH,
        }
    }

    /// 把 核心 crate `TeamFile` 反向映射成 `SquadSpec`。
    pub fn from_team_file(team: &reflect_task::TeamFile) -> SquadSpec {
        let mut leader_actor = Actor::agent(&team.name, "team-lead");
        let mut members: Vec<SquadMember> = Vec::new();
        for m in &team.members {
            if m.agent_id == team.lead_agent_id {
                // leader —— 用成员的 name 覆盖 displayName。
                if !m.name.is_empty() {
                    leader_actor.display_name = Some(m.name.clone());
                }
                continue;
            }
            let actor = crate::actor::actor_from_team_member(m);
            members.push(SquadMember {
                actor,
                role: m.role.clone(),
                model: m.model.clone(),
                system_prompt: m.system_prompt.clone(),
                allowed_tools: m.allowed_tools.clone(),
            });
        }
        SquadSpec {
            name: team.name.clone(),
            description: team.description.clone(),
            leader_actor,
            members,
            created_at_ms: team
                .created_at
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        }
    }

    /// 创建 / 覆盖一个 squad(upsert team)。
    pub async fn create_squad(&self, mut spec: SquadSpec) -> Result<(), SquadError> {
        Self::validate_name(&spec.name)?;
        // leader actor 的 actorId 必须是 `team-lead@<name>` 形式 —— 强制对齐。
        spec.leader_actor = Actor::agent(&spec.name, "team-lead");
        // 若调用方没填创建时间,用当前时间。
        if spec.created_at_ms == 0 {
            spec.created_at_ms = now_ms();
        }
        let team = Self::to_team_file(&spec);
        self.task_manager.upsert_team(team).await.map_err(tm_err)
    }

    /// 列出所有 squad。
    pub async fn list_squads(&self) -> Result<Vec<SquadSpec>, SquadError> {
        let teams = self.task_manager.list_teams().await.map_err(tm_err)?;
        Ok(teams.iter().map(Self::from_team_file).collect())
    }

    /// 读单个 squad。
    pub async fn get_squad(&self, name: &str) -> Result<SquadSpec, SquadError> {
        let team = self.task_manager.get_team(name).await.map_err(tm_err)?;
        Ok(Self::from_team_file(&team))
    }

    /// 删除 squad(team 文件物理删除;task 不级联)。
    pub async fn delete_squad(&self, name: &str) -> Result<(), SquadError> {
        self.task_manager.delete_team(name).await.map_err(tm_err)
    }

    /// leader 原子认领下一个 Pending+unblocked 任务(`claim_next_available`)。
    ///
    /// 返回 `Some(task)` 表示认领成功;`None` 表示 squad 下当前无可用任务。
    pub async fn delegate_next(
        &self,
        squad_name: &str,
        leader_actor_id: &str,
    ) -> Result<Option<reflect_task::Task>, SquadError> {
        let list = squad_name.to_string();
        self.task_manager
            .claim_next_available(&list, leader_actor_id)
            .await
            .map_err(tm_err)
    }

    /// 把任务分配给具体成员(写 `owner` + `metadata.actor`)。
    ///
    /// `assignee_actor_id` 形如 `"architect@rocket"`;`None` 清空分配。
    ///
    /// **保留既有 metadata**:只合并 / 删除 `actor` 子键,不会用空对象
    /// 覆盖整个 `Task.metadata`(避免丢失其他工具 / 集成写入的字段)。
    /// 实现是 read-modify-write:先取当前 task 的 metadata,克隆 → 改
    /// `actor` 键 → 回写。单进程桌面端无并发写同 task 的场景,够安全。
    pub async fn assign_task(
        &self,
        squad_name: &str,
        task_id: u32,
        assignee_actor_id: Option<String>,
    ) -> Result<reflect_task::Task, SquadError> {
        let actor = assignee_actor_id
            .as_ref()
            .map(|id| crate::actor::Actor::from_agent_id(id));
        let list = squad_name.to_string();
        // read-modify-write:合并 actor 到既有 metadata,而非整对象替换。
        let current = self
            .task_manager
            .get_task(&list, task_id, false)
            .await
            .map_err(tm_err)?;
        let mut metadata_obj = match &current.metadata {
            serde_json::Value::Object(map) => map.clone(),
            // 非 object(或 null):用空 map 起步,不沿用非法结构。
            _ => serde_json::Map::new(),
        };
        match &actor {
            Some(a) => {
                metadata_obj.insert(
                    "actor".into(),
                    serde_json::to_value(a).unwrap_or(serde_json::Value::Null),
                );
            }
            None => {
                metadata_obj.remove("actor");
            }
        }
        let merged = serde_json::Value::Object(metadata_obj);
        // owner 是三态:Some(Some(v)) 设值 / Some(None) 清空。
        let owner_patch = Some(assignee_actor_id);
        let patch = reflect_task::TaskPatch {
            owner: owner_patch,
            metadata: Some(merged),
            ..Default::default()
        };
        let outcome = self
            .task_manager
            .update_task(&list, task_id, patch)
            .await
            .map_err(tm_err)?;
        Ok(outcome.task)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actor::ActorKind;

    fn make_manager() -> SquadManager {
        let task_store = Arc::new(reflect_task::InMemoryTaskStore::default());
        let team_store = Arc::new(reflect_task::InMemoryTeamStore::default());
        let tm = Arc::new(reflect_task::TaskManager::new(task_store, team_store));
        SquadManager::new(tm)
    }

    fn sample_spec(name: &str) -> SquadSpec {
        SquadSpec {
            name: name.into(),
            description: Some("test squad".into()),
            leader_actor: Actor::agent(name, "team-lead"),
            members: vec![SquadMember {
                actor: Actor::agent(name, "builder"),
                role: "builder".into(),
                model: None,
                system_prompt: String::new(),
                allowed_tools: vec!["Write".into(), "Edit".into()],
            }],
            created_at_ms: 1000,
        }
    }

    #[tokio::test]
    async fn create_and_list_squad() {
        let m = make_manager();
        m.create_squad(sample_spec("rocket")).await.unwrap();
        let list = m.list_squads().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "rocket");
    }

    #[tokio::test]
    async fn get_squad_returns_leader_and_members() {
        let m = make_manager();
        m.create_squad(sample_spec("alpha")).await.unwrap();
        let s = m.get_squad("alpha").await.unwrap();
        assert_eq!(s.leader_actor.kind, ActorKind::Lead);
        assert_eq!(s.leader_actor.actor_id, "team-lead@alpha");
        assert_eq!(s.members.len(), 1);
        assert_eq!(s.members[0].role, "builder");
    }

    #[tokio::test]
    async fn delete_squad_removes_it() {
        let m = make_manager();
        m.create_squad(sample_spec("beta")).await.unwrap();
        m.delete_squad("beta").await.unwrap();
        assert!(m.get_squad("beta").await.is_err());
    }

    #[tokio::test]
    async fn invalid_name_rejected() {
        let m = make_manager();
        let mut bad = sample_spec("Bad Name With Spaces");
        bad.name = "Bad Name".into();
        assert!(m.create_squad(bad).await.is_err());
    }

    #[tokio::test]
    async fn roundtrip_team_file_preserves_members() {
        let spec = sample_spec("gamma");
        let team = SquadManager::to_team_file(&spec);
        assert_eq!(team.lead_agent_id, "team-lead@gamma");
        // 1 个 leader + 1 个成员 = 2 条目。
        assert_eq!(team.members.len(), 2);
        let back = SquadManager::from_team_file(&team);
        assert_eq!(back.name, "gamma");
        assert_eq!(back.members.len(), 1);
        assert_eq!(back.members[0].role, "builder");
    }

    #[tokio::test]
    async fn delegate_next_claims_pending_task() {
        let m = make_manager();
        m.create_squad(sample_spec("delta")).await.unwrap();
        // 在 "delta" list 中创建一个 task。
        let task = m
            .task_manager
            .create_task(
                &"delta".to_string(),
                "build".into(),
                "build it".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        let claimed = m.delegate_next("delta", "team-lead@delta").await.unwrap();
        assert!(claimed.is_some());
        assert_eq!(claimed.unwrap().id, task.id);
    }

    #[tokio::test]
    async fn delegate_next_none_when_no_tasks() {
        let m = make_manager();
        m.create_squad(sample_spec("epsilon")).await.unwrap();
        let claimed = m
            .delegate_next("epsilon", "team-lead@epsilon")
            .await
            .unwrap();
        assert!(claimed.is_none());
    }

    #[tokio::test]
    async fn assign_task_sets_owner_and_metadata() {
        let m = make_manager();
        m.create_squad(sample_spec("zeta")).await.unwrap();
        let task = m
            .task_manager
            .create_task(
                &"zeta".to_string(),
                "t1".into(),
                "desc".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        let updated = m
            .assign_task("zeta", task.id, Some("builder@zeta".into()))
            .await
            .unwrap();
        assert_eq!(updated.owner.as_deref(), Some("builder@zeta"));
        let actor = Actor::decode_metadata(&updated.metadata).unwrap();
        assert_eq!(actor.actor_id, "builder@zeta");
        assert_eq!(actor.kind, ActorKind::Member);
    }

    #[tokio::test]
    async fn assign_task_clears_assignee_with_none() {
        let m = make_manager();
        m.create_squad(sample_spec("eta")).await.unwrap();
        let task = m
            .task_manager
            .create_task(
                &"eta".to_string(),
                "t1".into(),
                "desc".into(),
                None,
                None,
                serde_json::json!({}),
            )
            .await
            .unwrap();
        // 先 assign 再 clear。
        m.assign_task("eta", task.id, Some("builder@eta".into()))
            .await
            .unwrap();
        let cleared = m.assign_task("eta", task.id, None).await.unwrap();
        assert!(cleared.owner.is_none());
        // 清空 assignee 后 actor 子键也应被移除。
        assert!(Actor::decode_metadata(&cleared.metadata).is_none());
    }

    #[tokio::test]
    async fn assign_task_preserves_existing_metadata_on_clear() {
        // 回归:清空 assignee 不应擦掉既有 metadata 的其他键。
        let m = make_manager();
        m.create_squad(sample_spec("theta")).await.unwrap();
        // 创建任务时带 extra metadata。
        let task = m
            .task_manager
            .create_task(
                &"theta".to_string(),
                "t1".into(),
                "desc".into(),
                None,
                None,
                serde_json::json!({ "source": "importer", "priority": 5 }),
            )
            .await
            .unwrap();
        // assign 写入 actor(应保留 source / priority)。
        let assigned = m
            .assign_task("theta", task.id, Some("builder@theta".into()))
            .await
            .unwrap();
        assert_eq!(assigned.metadata["source"], "importer");
        assert_eq!(assigned.metadata["priority"], 5);
        assert!(assigned.metadata.get("actor").is_some());
        // clear 移除 actor 但保留 source / priority。
        let cleared = m.assign_task("theta", task.id, None).await.unwrap();
        assert_eq!(cleared.metadata["source"], "importer");
        assert_eq!(cleared.metadata["priority"], 5);
        assert!(cleared.metadata.get("actor").is_none());
    }

    #[tokio::test]
    async fn squad_error_display() {
        let e = SquadError::NotFound { name: "x".into() };
        assert!(e.to_string().contains("x"));
        let e2 = SquadError::Invalid {
            message: "bad".into(),
        };
        assert!(e2.to_string().contains("bad"));
    }

    #[test]
    fn validate_name_accepts_legal() {
        assert!(SquadManager::validate_name("rocket").is_ok());
        assert!(SquadManager::validate_name("a-b_c").is_ok());
    }

    #[test]
    fn validate_name_rejects_illegal() {
        assert!(SquadManager::validate_name("").is_err());
        assert!(SquadManager::validate_name("Has Space").is_err());
        assert!(SquadManager::validate_name("UPPER").is_err());
    }
}
