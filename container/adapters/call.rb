# Ruby call adapter (v8 §4.6), as call.py is Python's: calls named functions
# of one bundle file in ONE process, step after step, keeping saved results,
# and reports each step as a JSON line. The runner (build-runner.mjs
# verifyChecks) owns the comparison: steps arrive without their expectations.
#
# Two processes, as call.py's. The SUPERVISOR (this file run as `call.rb
# <nonce-file>`) never loads bundle code: it reads this run's nonce from the
# file, deletes it, starts the WORKER (`call.rb --worker`, a fresh
# interpreter that never held the nonce), forwards the request, and re-emits
# each worker record with the nonce attached. It reports the end
# ({"done":true}) only when the worker answered every step and then exited 0
# by itself; a file that exits at load or in a step never produces a done.
# stdin: {"module":"<bundle path>","steps":[{call,args,save?}]} (JSON lines).
# stdout: as call.py's.
#
# A function is the name the file defines it by: a method it defines at its
# top level (Ruby's functions), called with the step's arguments.
#
# KNOWN LIMIT: as call.py's. The worker runs bundle code, so that code
# controls what the worker reports; the defence is that a requirement's
# check is never shown to the agents that write the code (S4b).
require 'json'

def supervise
  nonce = File.read(ARGV[0]).strip
  File.delete(ARGV[0])
  emit = ->(record) { STDOUT.write(JSON.generate({'nonce' => nonce}.merge(record)) + "\n"); STDOUT.flush }
  request = STDIN.read
  done = false
  status = nil
  IO.popen([RbConfig.ruby, __FILE__, '--worker'], 'r+') do |io|
    io.write(request)
    io.close_write
    io.each_line do |raw|
      record = begin JSON.parse(raw) rescue nil end
      next unless record.is_a?(Hash)
      if record['done'] == true then done = true; next end
      next if done # nothing counts after the worker's end
      if record['step'].is_a?(Integer)
        clean = {'step' => record['step'], 'ok' => record['ok'] == true}
        %w[value error stack missing].each { |k| clean[k] = record[k] if record.key?(k) }
        emit.call(clean)
      elsif record['load'] == false
        emit.call({'load' => false, 'error' => record['error'].to_s, 'stack' => record['stack'].to_s})
      end
    end
  end
  status = $?.exitstatus
  if status != 0 then emit.call({'worker_exit' => status.nil? ? -1 : status})
  elsif done then emit.call({'done' => true})
  end
end

def work
  generate = JSON.method(:generate)
  out = STDOUT.dup
  out.sync = true
  emit = ->(record) { out.write(generate.call(record) + "\n") }
  # The file's own output goes to stderr: stdout is the protocol's.
  STDOUT.reopen(STDERR)
  $stdout = STDERR

  lines = STDIN.read.split("\n").reject { |l| l.strip.empty? }
  request = lines.empty? ? {} : JSON.parse(lines[0])
  steps = (request['steps'].is_a?(Array) ? request['steps'] : []) + lines[1..].to_a.map { |l| JSON.parse(l) }
  module_path = request['module'].to_s
  error_text = ->(e) { "#{e.class}: #{e.message}" }
  stack_text = ->(e) { (e.backtrace || []).join("\n") }
  plain = lambda do |v|
    JSON.parse(generate.call([v]))[0]
  rescue StandardError, JSON::NestingError
    v.inspect
  end
  saved_ref = /\A\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)\z/
  substitute = nil
  substitute = lambda do |arg, saved|
    case arg
    when String
      m = saved_ref.match(arg)
      return arg unless m && saved.key?(m[1])
      m[2].split('.').drop(1).reduce(saved[m[1]]) do |v, key|
        if v.is_a?(Hash) then v.key?(key) ? v[key] : v[key.to_sym]
        elsif v.is_a?(Array) && key.match?(/\A\d+\z/) then v[key.to_i]
        elsif !v.nil? && v.respond_to?(key) then v.public_send(key)
        end
      end
    when Array then arg.map { |a| substitute.call(a, saved) }
    when Hash then arg.transform_values { |a| substitute.call(a, saved) }
    else arg
    end
  end

  before = Object.private_instance_methods(false) + Object.public_instance_methods(false)
  root = Dir.pwd
  absolute = File.expand_path(module_path, root)
  $LOAD_PATH.push(root, File.dirname(absolute))
  begin
    load absolute
  rescue Exception => e # a SyntaxError, a LoadError, an exit at load
    emit.call({'load' => false, 'error' => error_text.call(e), 'stack' => stack_text.call(e)})
    emit.call({'done' => true})
    return
  end
  defined_names = (Object.private_instance_methods(false) + Object.public_instance_methods(false) - before).map(&:to_s)
  saved = {}
  steps.each_with_index do |step, i|
    name = step['call']
    unless name.is_a?(String) && defined_names.include?(name)
      emit.call({'step' => i, 'ok' => false, 'missing' => true, 'error' => "#{module_path} has no function #{name} (it defines: #{defined_names.empty? ? 'no functions' : defined_names.join(', ')})", 'stack' => ''})
      next
    end
    begin
      args = (step['args'].is_a?(Array) ? step['args'] : []).map { |a| substitute.call(a, saved) }
      value = TOPLEVEL_BINDING.receiver.send(name, *args)
      saved[step['save']] = value if step['save'].is_a?(String) && !step['save'].empty?
      emit.call({'step' => i, 'ok' => true, 'value' => plain.call(value)})
    rescue Exception => e # a step's exit is its failure, not the adapter's end
      emit.call({'step' => i, 'ok' => false, 'error' => error_text.call(e), 'stack' => stack_text.call(e)})
    end
  end
  emit.call({'done' => true})
end

ARGV[0] == '--worker' ? work : supervise
