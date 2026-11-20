import path from 'node:path'
import * as acorn from 'acorn'
import { ancestor } from 'acorn-walk'

const parse = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })

const isFunction = (node) => node?.type === 'FunctionDeclaration' || node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression'

const keyName = (key) => (key?.type === 'Identifier' ? key.name : null)

const bindingsIn = (file, ast) => {
  const bindings = new Map()
  for (const statement of ast.body) {
    if (statement.type === 'ImportDeclaration' && statement.source.value.startsWith('.')) {
      const from = path.posix.normalize(path.posix.join(path.posix.dirname(file), statement.source.value))
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          bindings.set(specifier.local.name, { from, imported: specifier.imported.name })
        }
      }
      continue
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      bindings.set(declaration.id.name, declaration)
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier') {
          bindings.set(declarator.id.name, declarator.init)
        }
      }
    }
  }
  return bindings
}

const resolveBinding = (bindings, file, name, seen = new Set()) => {
  const mark = `${file}:${name}`
  if (seen.has(mark)) {
    return null
  }
  seen.add(mark)
  const binding = bindings.get(file)?.get(name)
  if (!binding) {
    return null
  }
  if (binding.from) {
    return resolveBinding(bindings, binding.from, binding.imported, seen)
  }
  return { node: binding, file }
}

const insideNestedFunction = (fn, ancestors) => ancestors.some((item) => item !== fn && isFunction(item))

const subjectsIn = (fn) => {
  const names = new Set(fn.params[0]?.type === 'Identifier' ? [fn.params[0].name] : [])
  ancestor(fn, {
    VariableDeclarator(node, ancestors) {
      const object = node.init?.callee?.object
      if (!insideNestedFunction(fn, ancestors) && node.id.type === 'Identifier' && object?.type === 'Identifier' && names.has(object.name)) {
        names.add(node.id.name)
      }
    }
  })
  return names
}

const texts = (arrayNode, property) =>
  arrayNode.elements.flatMap((element) => {
    if (!property && element?.type === 'Literal' && typeof element.value === 'string') {
      return [element.value]
    }
    const entry = property && element?.type === 'ObjectExpression' && element.properties.find((item) => keyName(item.key) === property)
    return entry?.value.type === 'Literal' && typeof entry.value.value === 'string' ? [entry.value.value] : []
  })

const listValues = (expression, property, resolve) => {
  if (expression?.type === 'CallExpression' && keyName(expression.callee.property) === 'map') {
    const callback = expression.arguments[0]
    const taken = callback?.params?.[0]?.type === 'ObjectPattern' ? keyName(callback.params[0].properties.find((item) => item.type === 'Property')?.key) : null
    if (taken && callback.body?.type === 'Identifier' && callback.body.name === taken) {
      return listValues(expression.callee.object, taken, resolve)
    }
    return []
  }
  let current = expression
  const seen = new Set()
  while (current?.type === 'Identifier' && !seen.has(current)) {
    seen.add(current)
    current = resolve(current.name)?.node
  }
  return current?.type === 'ArrayExpression' ? texts(current, property) : []
}

const comparedCode = (callback, names) => {
  const body = callback?.body
  const param = callback?.params?.[0]
  if (param?.type !== 'Identifier' || body?.type !== 'BinaryExpression' || body.operator !== '===') {
    return null
  }
  const member = [body.left, body.right].find((side) => side.type === 'MemberExpression' && side.object.type === 'Identifier' && side.object.name === param.name && keyName(side.property) != null)
  const other = body.left === member ? body.right : body.left
  return member && other.type === 'Identifier' && names.has(other.name) ? keyName(member.property) : null
}

const valuesIn = (fn, file, bindings, seen) => {
  if (!isFunction(fn) || seen.has(fn)) {
    return []
  }
  seen.add(fn)
  const names = subjectsIn(fn)
  const resolve = (name) => resolveBinding(bindings, file, name)
  const found = []
  ancestor(fn, {
    CallExpression(node, ancestors) {
      if (insideNestedFunction(fn, ancestors)) {
        return
      }
      const callee = node.callee
      const called = keyName(callee.property)
      if (called === 'includes' && node.arguments[0]?.type === 'Identifier' && names.has(node.arguments[0].name)) {
        found.push(...listValues(callee.object, null, resolve))
      }
      if (called === 'some') {
        const property = comparedCode(node.arguments[0], names)
        if (property) {
          found.push(...listValues(callee.object, property, resolve))
        }
      }
      if (callee.type === 'Identifier' && node.arguments.some((argument) => argument.type === 'Identifier' && names.has(argument.name))) {
        const target = resolve(callee.name)
        if (isFunction(target?.node)) {
          found.push(...valuesIn(target.node, target.file, bindings, seen))
        }
      }
    }
  })
  return found
}

export const customAllowedValuesFrom = (files) => {
  const parsed = new Map(Object.entries(files).map(([file, source]) => [file, parse(source)]))
  const bindings = new Map([...parsed].map(([file, ast]) => [file, bindingsIn(file, ast)]))
  const lists = new Map()
  for (const [file, ast] of parsed) {
    if (!file.includes('/schemas/')) {
      continue
    }
    ancestor(ast, {
      CallExpression(node, ancestors) {
        if (keyName(node.callee.property) !== 'custom') {
          return
        }
        const field = ancestors.findLast((item) => item.type === 'Property' && !item.computed)
        const fieldName = field && keyName(field.key)
        const argument = node.arguments[0]
        const validator = isFunction(argument) ? { node: argument, file } : argument?.type === 'Identifier' ? resolveBinding(bindings, file, argument.name) : null
        const values = isFunction(validator?.node) ? valuesIn(validator.node, validator.file, bindings, new Set()) : []
        if (fieldName && values.length > 0) {
          lists.set(fieldName, [...new Set([...(lists.get(fieldName) ?? []), ...values])])
        }
      }
    })
  }
  return Object.fromEntries(lists)
}
