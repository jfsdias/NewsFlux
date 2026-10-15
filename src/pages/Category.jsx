import { useStore } from "@nanostores/react"
import { useCallback } from "react"
import { useParams } from "react-router"

import { getCategoryEntries } from "@/apis"
import Content from "@/components/Content/Content"
import { catalogCategoriesState } from "@/store/dataState"

const Category = () => {
  const { id: categoryId } = useParams()
  const categories = useStore(catalogCategoriesState)
  const categoryIsGloballyHidden = categories.some(
    (category) => category.id === Number(categoryId) && category.hide_globally,
  )

  const getEntries = useCallback(
    (status, starred, filterParams) =>
      getCategoryEntries(categoryId, status, starred, {
        ...filterParams,
        ...(categoryIsGloballyHidden && { globally_visible: false }),
      }),
    [categoryId, categoryIsGloballyHidden],
  )
  return <Content getEntries={getEntries} info={{ from: "category", id: categoryId }} />
}

export default Category
