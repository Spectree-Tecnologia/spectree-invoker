import type { Plan, PlanTask } from './state'

type Field = (key: string) => unknown

// The main loop's plan as its task tools leave it: TaskCreate adds a task under
// the id its result gives, TaskUpdate changes or deletes one, TodoWrite replaces
// the whole list. Any other tool leaves the plan as it is.
export function applyToPlan(plan: Plan, tool: string, input: Field, result: unknown): Plan {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  if (tool === 'TaskCreate') {
    const id = text((result as { task?: { id?: unknown } } | undefined)?.task?.id)
    const subject = text(input('subject'))
    if (!id || !subject) return plan
    const task: PlanTask = { id, subject, activeForm: text(input('activeForm')), status: 'pending' }
    return { ...plan, tasks: [...plan.tasks.filter(one => one.id !== id), task] }
  }
  if (tool === 'TaskUpdate') {
    // An update the tool refused leaves the task as it was.
    if ((result as { success?: unknown } | undefined)?.success === false) return plan
    const id = text(input('taskId'))
    const status = text(input('status'))
    if (!id || !plan.tasks.some(one => one.id === id)) return plan
    if (status === 'deleted') return { ...plan, tasks: plan.tasks.filter(one => one.id !== id) }
    return {
      ...plan,
      tasks: plan.tasks.map(one =>
        one.id === id
          ? {
              ...one,
              subject: text(input('subject')) ?? one.subject,
              activeForm: text(input('activeForm')) ?? one.activeForm,
              status: status === 'pending' || status === 'in_progress' || status === 'completed' ? status : one.status,
            }
          : one,
      ),
    }
  }
  if (tool === 'TodoWrite') {
    const todos = input('todos')
    if (!Array.isArray(todos)) return plan
    // A todo list has no title: it does not carry the last plan's.
    return {
      tasks: todos.flatMap((todo, i) => {
        const subject = text(todo?.content)
        const status = text(todo?.status)
        if (!subject || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return []
        return [{ id: `todo-${i}`, subject, activeForm: text(todo?.activeForm), status }]
      }),
    }
  }
  return plan
}

const STATUSES = ['pending', 'in_progress', 'completed'] as const

// The plan tool's call, whole list each time: the new plan, or why it was not
// taken, and the one line the model reads back.
export function planFromTool(plan: Plan, input: Field): { plan: Plan; said: string } {
  const steps = input('steps')
  if (!Array.isArray(steps)) return { plan, said: 'Plan not saved: send steps as a list of { text, status }.' }
  const tasks: PlanTask[] = []
  for (const [i, step] of steps.entries()) {
    const subject = typeof step?.text === 'string' ? step.text.replace(/\s+/g, ' ').trim() : ''
    if (!subject) return { plan, said: 'Plan not saved: every step needs its text.' }
    if (!STATUSES.includes(step?.status)) {
      return { plan, said: `Plan not saved: "${subject.slice(0, 40)}" needs a status of pending, in_progress or completed.` }
    }
    tasks.push({ id: `step-${i}`, subject, status: step.status })
  }
  // A title is a label beside the bar, a few words: past 40 characters it is cut.
  const title = typeof input('title') === 'string' ? String(input('title')).replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  const done = tasks.filter(one => one.status === 'completed').length
  // An untitled list carries on the plan under way; after a finished one it starts untitled.
  const isOver = plan.tasks.length === 0 || plan.tasks.every(one => one.status === 'completed')
  return { plan: { title: title || (isOver ? undefined : plan.title), tasks }, said: `Plan saved: ${done} of ${tasks.length} steps done.` }
}

// What the plan bar reads: tasks done of all, and the line under it — the task
// under way in its present-continuous form, else the next one, else done.
export function planProgress(plan: Plan): {
  title: string
  done: number
  total: number
  percent: number
  now: string
  isLive: boolean
} {
  const total = plan.tasks.length
  const done = plan.tasks.filter(one => one.status === 'completed').length
  const current = plan.tasks.find(one => one.status === 'in_progress')
  const next = plan.tasks.find(one => one.status === 'pending')
  const now = current
    ? `Agora: ${current.activeForm || current.subject}`
    : next
      ? `A seguir: ${next.subject}`
      : 'Plano concluído'
  return {
    title: plan.title || 'Plano',
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    now,
    isLive: current !== undefined,
  }
}
