-- Migration: 0005_direct_chat_enhancements.sql
-- Function to get or create a 1-on-1 direct conversation between the authenticated user and another user

create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_conversation_id uuid;
  new_conversation_id uuid;
  my_id uuid := auth.uid();
begin
  if my_id is null then
    raise exception 'Not authenticated';
  end if;

  if my_id = other_user_id then
    raise exception 'Cannot create a direct conversation with yourself';
  end if;

  -- Look for an existing conversation that has EXACTLY both members
  select cm1.conversation_id into existing_conversation_id
  from public.conversation_members cm1
  inner join public.conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  where cm1.user_id = my_id
    and cm2.user_id = other_user_id
  limit 1;

  if existing_conversation_id is not null then
    return existing_conversation_id;
  end if;

  -- Create a new conversation
  insert into public.conversations (owner_id, title)
  values (my_id, null)
  returning id into new_conversation_id;

  -- Add both members
  insert into public.conversation_members (conversation_id, user_id)
  values
    (new_conversation_id, my_id),
    (new_conversation_id, other_user_id);

  return new_conversation_id;
end;
$$;

-- Grant execution to authenticated users
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
