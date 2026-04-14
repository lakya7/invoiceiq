import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const ROLES = ["admin", "member", "viewer"];
const ROLE_DESC = { admin: "Can manage team, invite members, approve invoices", member: "Can upload and process invoices", viewer: "Read-only access to invoices and POs" };

function RoleBadge({ role }) {
  const colors = { admin: { bg: "#fef3c7", color: "#92400e" }, member: { bg: "#dbeafe", color: "#1d4ed8" }, viewer: { bg: "#f3f4f6", color: "#374151" } };
  const c = colors[role] || colors.viewer;
  return <span style={{ background: c.bg, color: c.color, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{role}</span>;
}

function StatusDot({ status }) {
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: status === "active" ? "#16a34a" : "#f59e0b", display: "inline-block", marginRight: 6 }} />;
}

export default function TeamManagement({ user, team, onBack }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("members"); // members | roles

  const isAdmin = team?.role === "admin";

  useEffect(() => { fetchMembers(); }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/teams/${team.id}/members`);
      const data = await res.json();
      if (data.success) setMembers(data.members);
    } catch (e) { showToast("Failed to load members", "error"); }
    setLoading(false);
  };

  const invite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const res = await fetch(`${API}/api/teams/${team.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, invitedBy: user.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast(`Invite sent to ${inviteEmail}!`, "success");
      setInviteEmail("");
      fetchMembers();
    } catch (e) { showToast(e.message, "error"); }
    setInviting(false);
  };

  const updateRole = async (memberId, role) => {
    try {
      const res = await fetch(`${API}/api/teams/${team.id}/members/${memberId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setMembers(m => m.map(x => x.id === memberId ? { ...x, role } : x));
      showToast("Role updated", "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const removeMember = async (memberId, email) => {
    if (!confirm(`Remove ${email} from the team?`)) return;
    try {
      const res = await fetch(`${API}/api/teams/${team.id}/members/${memberId}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setMembers(m => m.filter(x => x.id !== memberId));
      showToast("Member removed", "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="team-page">
      <div className="team-header">
        <button className="settings-back" onClick={onBack}>← Dashboard</button>
        <div className="team-header-row">
          <div>
            <h1 className="team-title">{team.name}</h1>
            <p className="team-sub">Manage your team members and permissions</p>
          </div>
          <div className="team-your-role"><RoleBadge role={team.role} /> Your role</div>
        </div>

        <div className="team-tabs">
          {["members","roles"].map(t => (
            <button key={t} className={`team-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "members" ? "👥 Members" : "🔐 Role Permissions"}
            </button>
          ))}
        </div>
      </div>

      <div className="team-content">
        {tab === "members" && (
          <>
            {/* Invite */}
            {isAdmin && (
              <div className="settings-card">
                <div className="settings-card-title">Invite Team Member</div>
                <div className="settings-card-sub">They'll receive an email invitation</div>
                <div className="settings-card-body">
                  <form onSubmit={invite} className="invite-form">
                    <input
                      className="settings-input invite-input"
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      required
                    />
                    <select className="settings-input invite-select" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                    <button className="btn-approve invite-btn" type="submit" disabled={inviting}>
                      {inviting ? "Sending..." : "Send Invite →"}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Members list */}
            <div className="settings-card">
              <div className="settings-card-title">{members.length} Team Member{members.length !== 1 ? "s" : ""}</div>
              <div className="members-list">
                {loading ? (
                  <div className="table-loading">Loading members...</div>
                ) : members.map(m => {
                  const isMe = m.user_id === user.id;
                  const isOwner = m.role === "admin" && team.owner_id === m.user_id;
                  return (
                    <div key={m.id} className="member-row">
                      <div className="member-avatar">{m.email?.[0]?.toUpperCase()}</div>
                      <div className="member-info">
                        <div className="member-email">
                          {m.email} {isMe && <span className="you-badge">you</span>}
                        </div>
                        <div className="member-meta">
                          <StatusDot status={m.status} />
                          {m.status === "active" ? `Joined ${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ""}` : "Invitation pending"}
                        </div>
                      </div>
                      <div className="member-actions">
                        {isAdmin && !isMe ? (
                          <>
                            <select
                              className="role-select"
                              value={m.role}
                              onChange={e => updateRole(m.id, e.target.value)}
                            >
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button className="remove-btn" onClick={() => removeMember(m.id, m.email)}>✕</button>
                          </>
                        ) : (
                          <RoleBadge role={m.role} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {tab === "roles" && (
          <div className="settings-card">
            <div className="settings-card-title">Role Permissions</div>
            <div className="settings-card-sub">What each role can do in InvoiceIQ</div>
            <div className="settings-card-body">
              <div className="roles-table-wrap">
                <table className="roles-table">
                  <thead>
                    <tr>
                      <th>Permission</th>
                      <th>Admin</th>
                      <th>Member</th>
                      <th>Viewer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Upload & process invoices", true, true, false],
                      ["View all invoices", true, true, true],
                      ["Approve invoices", true, true, false],
                      ["Upload purchase orders", true, true, false],
                      ["View purchase orders", true, true, true],
                      ["Invite team members", true, false, false],
                      ["Manage member roles", true, false, false],
                      ["Configure ERP settings", true, false, false],
                      ["View team dashboard", true, true, true],
                      ["Delete invoices", true, false, false],
                      ["Manage billing", true, false, false],
                    ].map(([perm, admin, member, viewer]) => (
                      <tr key={perm}>
                        <td>{perm}</td>
                        <td>{admin ? "✅" : "—"}</td>
                        <td>{member ? "✅" : "—"}</td>
                        <td>{viewer ? "✅" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && <div className={`settings-toast ${toast.type}`}>{toast.type === "success" ? "✓" : "⚠"} {toast.msg}</div>}
    </div>
  );
}
