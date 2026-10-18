import type { ReactElement } from 'react'
import FriendActivityPanel from '../../components/FriendActivity/FriendActivityPanel'
import type { DownloadTarget } from '../../types'

export interface FriendActivityPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export default function FriendActivityPage(_props: FriendActivityPageProps = {}): ReactElement {
  return (
    <div className="min-h-full w-full flex flex-col bg-canvas text-text">
      <FriendActivityPanel isPage />
    </div>
  )
}
