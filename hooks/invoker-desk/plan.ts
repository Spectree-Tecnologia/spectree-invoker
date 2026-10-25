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
    return { tasks: [...plan.tasks.filter(one => one.id !== id), task] }
  }
  if (tool === 'TaskUpdate') {
    // An update the tool refused leaves the task as it was.
    if ((result as { success?: unknown } | undefined)?.success === false) return plan
    const id = text(input('taskId'))
    const status = text(input('status'))
    if (!id || !plan.tasks.some(one => one.id === id)) return plan
    if (status === 'deleted') return { tasks: plan.tasks.filter(one => one.id !== id) }
    return {
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

// What the plan bar reads: tasks done of all, and the line under it — the task
// under way in its present-continuous form, else the next one, else done.
export function planProgress(plan: Plan): { done: number; total: number; percent: number; now: string } {
  const total = plan.tasks.length
  const done = plan.tasks.filter(one => one.status === 'completed').length
  const current = plan.tasks.find(one => one.status === 'in_progress')
  const next = plan.tasks.find(one => one.status === 'pending')
  const now = current
    ? `Agora: ${current.activeForm || current.subject}`
    : next
      ? `A seguir: ${next.subject}`
      : 'Plano concluído'
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), now }
}
